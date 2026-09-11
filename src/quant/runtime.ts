/**
 * 量化运行时（常驻）：QuoteFeed 驱动。
 *  - 档案信号：对启用档案的选股池重算 TradeSignal → signalStore + 告警
 *  - 自动交易：对 enabled+autoTrade 档案跑专属模拟盘买卖/风控
 * 没有独立「信号内核」；一切以 StrategyProfile 为准。
 */
import type { Candle, Exchange, Quote, Symbol } from '@/data/api';
import { marketData } from '@/data/api';
import { quoteFeed } from '@/data/QuoteFeed';
import { getGroups } from '@/data/repositories/WatchlistRepository';
import { quantStore } from '@/data/db/QuantStore';
import { userStore } from '@/data/db/UserStore';
import { createAccountRepo, type AccountRepo, type SimAccount } from '@/simulation';
import { toFullCode } from '@/domain';
import type { AlertEvent, TradeSignal } from '@/domain';
import {
  checkExitRules,
  checkTrailingStop,
  evaluateProfile,
  inTradeSession,
  passesSelection,
  type StrategyProfile,
} from './profile';
import { getProfiles } from './profileStore';
import { computeProfileSignal } from './signals';
import { saveSignal } from './signalStore';
import { signalToAlertEvent } from './signalAlerts';
import { recordAlerts } from '@/features/watchlist/alertHistory';
import { getMutedSignalStrategies } from '@/features/watchlist/userAlertRules';

export interface StrategyRunEvent {
  ts: number;
  profileId: string;
  name: string;
  symbolKey: string;
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  reason: string;
}

let started = false;
let processing = false;
let unsubscribe: (() => void) | null = null;
let signalNotifier: ((events: AlertEvent[]) => void) | null = null;

const repoCache = new Map<string, AccountRepo>();
const klineCache = new Map<string, { ts: number; candles: Candle[] }>();
const peaks = new Map<string, number>();
const lastOrderBar = new Map<string, string>();
const subscribedPool = new Set<string>();
const signalState = new Map<string, { at: number; lastQuote: number | null }>();
const recentEvents: StrategyRunEvent[] = [];
const MAX_EVENTS = 80;
const KLINE_TTL = 60_000;
const SIGNAL_RECOMPUTE_MIN_MS = 30_000;

export function setSignalNotifier(fn: ((events: AlertEvent[]) => void) | null): void {
  signalNotifier = fn;
}

export function recentStrategyEvents(): StrategyRunEvent[] {
  return [...recentEvents];
}

export function strategyAccountRepo(profileId: string): AccountRepo {
  let r = repoCache.get(profileId);
  if (!r) {
    r = createAccountRepo(`strategy:${profileId}`);
    repoCache.set(profileId, r);
  }
  return r;
}

function pushEvent(e: Omit<StrategyRunEvent, 'ts'>): void {
  recentEvents.unshift({ ...e, ts: Date.now() });
  if (recentEvents.length > MAX_EVENTS) recentEvents.length = MAX_EVENTS;
}

function closeKey(profileId: string, symKey: string): string {
  return `${profileId}:${symKey}`;
}

function qtyForBuy(acc: SimAccount, price: number, ratio: number): number {
  if (price <= 0 || acc.cash <= 0) return 0;
  const perShare = price * 1.00025 + 5 + price * 0.0001;
  return Math.floor((acc.cash * ratio) / perShare / 100) * 100;
}

async function resolveScanPool(): Promise<Symbol[]> {
  const snaps = await quantStore().listScanSnapshots(1);
  const snap = snaps[0];
  if (!snap?.id) return [];
  if (Date.now() - snap.createdAt > 24 * 3600_000) return [];
  const hits = await quantStore().listScanHits(snap.id);
  const seen = new Set<string>();
  const out: Symbol[] = [];
  for (const h of hits) {
    if (!h.code || !h.exchange) continue;
    const s: Symbol = { code: h.code, exchange: h.exchange as Exchange, name: h.name || undefined };
    const k = toFullCode(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

async function resolveWatchlistPool(): Promise<Symbol[]> {
  const groups = await getGroups();
  const seen = new Set<string>();
  const out: Symbol[] = [];
  for (const g of groups) {
    for (const s of g.symbols ?? []) {
      const k = toFullCode(s);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

export async function resolvePool(profile: StrategyProfile): Promise<Symbol[]> {
  if (profile.selection.universe === 'scan') {
    const pool = await resolveScanPool();
    if (pool.length > 0) return pool;
    return resolveWatchlistPool();
  }
  return resolveWatchlistPool();
}

async function fetchCandles(profile: StrategyProfile, symbol: Symbol): Promise<Candle[]> {
  const key = `${profile.trade.period}:${toFullCode(symbol)}`;
  const hit = klineCache.get(key);
  if (hit && Date.now() - hit.ts < KLINE_TTL) return hit.candles;
  try {
    const candles = await marketData.getKline({ symbol, period: profile.trade.period, count: 260 });
    if (candles && candles.length > 0) klineCache.set(key, { ts: Date.now(), candles });
    return candles ?? [];
  } catch {
    return [];
  }
}

function mapQuote(syms: string[], feedQuotes?: Quote[] | null): Map<string, Quote> {
  const quoteByKey = new Map<string, Quote>();
  if (syms.length === 0) return quoteByKey;
  const feedByKey = new Map<string, Quote>();
  for (const q of feedQuotes ?? []) feedByKey.set(toFullCode(q.symbol), q);
  const symObjs = syms
    .map((k) => {
      const [exchange, code] = k.split('.');
      return { exchange: exchange as Symbol['exchange'], code };
    })
    .filter((s) => s.code);
  const needFetch: Symbol[] = [];
  for (const s of symObjs) {
    const q = feedByKey.get(toFullCode(s));
    if (q) quoteByKey.set(toFullCode(s), q);
    else needFetch.push(s);
  }
  return quoteByKey;
}

/** 档案信号重算（不依赖 autoTrade） */
async function recomputeSignals(profiles: StrategyProfile[], symbols: Symbol[], feedQuotes?: Quote[] | null): Promise<TradeSignal[]> {
  const enabled = profiles.filter((p) => p.enabled);
  if (enabled.length === 0) return [];
  const quoteByKey = mapQuote(symbols.map((s) => toFullCode(s)), feedQuotes);
  const missing = symbols.filter((s) => !quoteByKey.get(toFullCode(s)));
  if (missing.length > 0) {
    try {
      const fetched = await marketData.getQuotes(missing);
      for (const q of fetched) quoteByKey.set(toFullCode(q.symbol), q);
    } catch {
      // ignore
    }
  }

  const now = Date.now();
  const newSignals: TradeSignal[] = [];
  for (const sym of symbols) {
    const k = toFullCode(sym);
    const quote = quoteByKey.get(k);
    if (!quote || quote.last <= 0) continue;
    const state = signalState.get(k);
    if (state && now - state.at < SIGNAL_RECOMPUTE_MIN_MS && state.lastQuote === quote.last) continue;

    // 用第一条启用档案的周期拉 K 线（档案周期可不同，详情页按需再拉）
    const period = enabled[0]?.trade.period ?? 'day';
    let candles: Candle[] = [];
    try {
      candles = await marketData.getKline({ symbol: sym, period, count: 260 }) ?? [];
    } catch {
      continue;
    }
    if (candles.length < 2) continue;

    for (const p of enabled) {
      const cs = p.trade.period === period ? candles : await fetchCandles(p, sym);
      const sig = computeProfileSignal(p, sym, cs, quote);
      if (sig) {
        saveSignal(sig);
        newSignals.push(sig);
      }
    }
    signalState.set(k, { at: now, lastQuote: quote.last });
  }

  if (newSignals.length > 0 && signalNotifier) {
    const holds = await userStore.getHoldings().catch(() => []);
    const heldQtyByKey = new Map(holds.map((h) => [toFullCode(h.symbol), h.shares]));
    const muted = await getMutedSignalStrategies().catch(() => new Set<string>());
    const alertEvents = newSignals
      .map((s) => signalToAlertEvent(s, 1, { heldQtyByKey }))
      .filter((e): e is AlertEvent => e !== null)
      .filter((e) => {
        if (muted.size === 0) return true;
        const pid = e.ruleId.startsWith('signal_') ? e.ruleId.slice('signal_'.length) : '';
        return !muted.has(pid);
      });
    if (alertEvents.length > 0) {
      recordAlerts(alertEvents).catch(() => {});
      signalNotifier(alertEvents);
    }
  }
  return newSignals;
}

async function runAutoTrade(profile: StrategyProfile, feedQuotes?: Quote[] | null): Promise<void> {
  if (!inTradeSession(profile.trade.session)) return;
  const accRepo = strategyAccountRepo(profile.id);
  const account = await accRepo.get();
  if (!account.initialized) return;

  const held = new Set(account.positions.map((p) => toFullCode(p.symbol)));
  const pool = await resolvePool(profile);
  const quoteSyms = Array.from(new Set([...pool.map((s) => toFullCode(s)), ...held]));
  const quoteByKey = mapQuote(quoteSyms, feedQuotes);

  const needFetch: Symbol[] = [];
  for (const k of quoteSyms) {
    if (quoteByKey.has(k)) continue;
    const [exchange, code] = k.split('.');
    if (code) needFetch.push({ code, exchange: exchange as Symbol['exchange'] });
  }
  if (needFetch.length > 0) {
    try {
      const fetched = await marketData.getQuotes(needFetch);
      for (const q of fetched) quoteByKey.set(toFullCode(q.symbol), q);
    } catch {
      // ignore
    }
  }

  for (const pos of account.positions) {
    if (pos.shares <= 0 || pos.available <= 0) continue;
    const symKey = toFullCode(pos.symbol);
    const quote = quoteByKey.get(symKey);
    if (!quote || quote.last <= 0) continue;
    const key = closeKey(profile.id, symKey);
    const peak = Math.max(peaks.get(key) ?? pos.costPrice, quote.last);

    const candles = await fetchCandles(profile, pos.symbol);
    const sig = candles.length > 0 ? evaluateProfile(profile, candles, quote) : null;
    let reason: string | null = null;
    if (sig?.side === 'sell' && sig.reason) {
      reason = `卖出信号 · ${sig.reason}`;
    } else {
      const hit = checkExitRules(pos.costPrice, quote.last, profile.exit);
      if (hit) reason = hit.reason;
      else if (checkTrailingStop(peak, quote.last, profile.exit.trailingPct)) {
        reason = `移动止损 ${profile.exit.trailingPct}%`;
      }
    }

    peaks.set(key, peak);
    if (reason) {
      const qty = Math.floor(pos.available / 100) * 100;
      if (qty > 0) {
        const { result } = await accRepo.submit({
          symbol: pos.symbol, side: 'sell', price: quote.last,
          quantity: qty, type: 'market', refPrice: quote.last,
        });
        if (result.ok) {
          pushEvent({ profileId: profile.id, name: profile.name, symbolKey: symKey, side: 'sell', price: quote.last, qty, reason });
          if (qty >= pos.shares) {
            peaks.delete(key);
            lastOrderBar.delete(key);
          }
        }
      }
    }
  }

  const freshAcc = await accRepo.get();
  const freshHeld = new Set(freshAcc.positions.map((p) => toFullCode(p.symbol)));
  if (freshHeld.size >= profile.trade.maxPositions) return;

  for (const symbol of pool) {
    if (freshHeld.size >= profile.trade.maxPositions) break;
    const symKey = toFullCode(symbol);
    if (freshHeld.has(symKey)) continue;
    const quote = quoteByKey.get(symKey);
    if (!passesSelection(profile.selection, quote ?? null)) continue;

    const candles = await fetchCandles(profile, symbol);
    if (candles.length === 0) continue;
    const latestBar = String(candles[candles.length - 1].datetime);
    if (lastOrderBar.get(closeKey(profile.id, symKey)) === latestBar) continue;
    const sig = evaluateProfile(profile, candles, quote ?? null);
    if (!sig || sig.side !== 'buy') continue;

    const acc2 = await accRepo.get();
    const qty = qtyForBuy(acc2, quote!.last, profile.trade.positionRatio);
    if (qty <= 0) continue;
    const { result } = await accRepo.submit({
      symbol, side: 'buy', price: quote!.last, quantity: qty, type: 'market', refPrice: quote!.last,
    });
    if (result.ok) {
      lastOrderBar.set(closeKey(profile.id, symKey), latestBar);
      peaks.set(closeKey(profile.id, symKey), quote!.last);
      pushEvent({ profileId: profile.id, name: profile.name, symbolKey: symKey, side: 'buy', price: quote!.last, qty, reason: sig.reason });
    }
  }
}

async function tick(feedQuotes?: Quote[] | null): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    const profiles = await getProfiles();
    const enabled = profiles.filter((p) => p.enabled);
    const actives = enabled.filter((p) => p.autoTrade);

    // 信号池：自选 + 自动交易档案的选股池
    const poolSyms: Symbol[] = [];
    const seen = new Set<string>();
    for (const s of await resolveWatchlistPool()) {
      const k = toFullCode(s);
      if (!seen.has(k)) {
        seen.add(k);
        poolSyms.push(s);
      }
    }
    for (const p of actives) {
      for (const s of await resolvePool(p)) {
        const k = toFullCode(s);
        if (!seen.has(k)) {
          seen.add(k);
          poolSyms.push(s);
        }
      }
    }

    await recomputeSignals(enabled, poolSyms, feedQuotes);

    for (const p of actives) {
      try {
        await runAutoTrade(p, feedQuotes ?? null);
      } catch {
        // 单策略异常不影响其它
      }
    }

    if (actives.length > 0) {
      const toSub: Symbol[] = [];
      for (const p of actives) {
        for (const s of await resolvePool(p)) {
          const k = toFullCode(s);
          if (!subscribedPool.has(k)) {
            subscribedPool.add(k);
            toSub.push(s);
          }
        }
      }
      if (toSub.length > 0) quoteFeed.subscribe(toSub);
    }
  } finally {
    processing = false;
  }
}

/** 启动量化运行时（幂等）。兼容旧 API 名。 */
export function startQuantRuntime(): void {
  if (started) return;
  started = true;
  unsubscribe = quoteFeed.subscribeListener((_symbols, quotes) => {
    tick(quotes).catch(() => undefined);
  });
  tick().catch(() => undefined);
}

export function stopQuantRuntime(): void {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
}

