/**
 * StrategyEngine —— 策略自动交易运行时（常驻、可开关）。
 *
 * 为每个「启用 + 开启自动交易」的策略档案：
 *  - 订阅其选股池行情（QuoteFeed 内置轮询，非交易时段自动停）；
 *  - 交易时段（按档案 trade.session）逐 tick 检查：
 *      持仓 → 止盈 / 止损 / 移动止损 / 策略卖出信号 → 市价全平（T+1 可用）
 *      空仓 → 选股过滤 + 信号内核买入 → 按仓位比例下单至该策略的专属模拟盘；
 *  - 同档行情 bar 只触发一次（lastBar 去重），杜绝重复开仓；
 *  - 事件写入内存环形日志，供 UI 读取展示最近动作。
 *
 * 引擎在 App 启动时随 SignalEngine 一起启动；止损/止盈数值来自策略档案，
 * 用户在编辑器改完即时生效（每次 tick 重读档案）。
 */
import { marketData } from '@/api';
import type { Candle, Quote, Symbol } from '@/api';
import { quoteFeed } from '@/services/QuoteFeed';
import { getGroups } from '@/repositories/WatchlistRepository';
import { createAccountRepo, type AccountRepo, type SimAccount } from '@/simulation';
import { toFullCode } from '@/domain';
import {
  checkExitRules,
  checkTrailingStop,
  evaluateProfile,
  inTradeSession,
  passesSelection,
  type StrategyProfile,
} from './profile';
import { getProfiles } from './profileStore';

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

const repoCache = new Map<string, AccountRepo>();
const klineCache = new Map<string, { ts: number; candles: Candle[] }>();
/** 移动止损峰值：`profileId:symKey` → 开仓后最高价 */
const peaks = new Map<string, number>();
/** 同 bar 防重：`profileId:symKey` → 最近一次下单的 bar datetime */
const lastOrderBar = new Map<string, string>();
/** 已订阅的策略选股池（增量订阅，避免随页面生命周期丢失） */
const subscribedPool = new Set<string>();
/** 最近事件环形日志（供 UI） */
const recentEvents: StrategyRunEvent[] = [];
const MAX_EVENTS = 80;

const KLINE_TTL = 60_000;

function repoOf(profileId: string): AccountRepo {
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

/** UI 读取最近事件（只读快照）。 */
export function recentStrategyEvents(): StrategyRunEvent[] {
  return [...recentEvents];
}

/** 取某档案专属模拟盘的账户仓库（UI 展示用）。 */
export function strategyAccountRepo(profileId: string): AccountRepo {
  return repoOf(profileId);
}

/** 取自选股池（去重）。 */
async function resolvePool(profile: StrategyProfile): Promise<Symbol[]> {
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
  if (profile.selection.universe !== 'watchlist') {
    // v0 只支持自选股池；未来接入全市场选股时在此扩展
  }
  return out;
}

/** 带缓存的 K 线拉取（同周期 60s 内复用）。 */
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

/** 买入数量估算：可用资金 × 仓位比例 → 向下取整到整手。 */
function qtyForBuy(acc: SimAccount, price: number, ratio: number): number {
  if (price <= 0 || acc.cash <= 0) return 0;
  const perShare = price * 1.00025 + 5 + price * 0.0001;
  const budget = acc.cash * ratio;
  return Math.floor(budget / perShare / 100) * 100;
}

function closeKey(profileId: string, symKey: string): string {
  return `${profileId}:${symKey}`;
}

/** 处理单个策略档案的整个流程（退出 → 入场）。 */
async function runProfile(profile: StrategyProfile, feedQuotes?: Quote[] | null): Promise<void> {
  if (!inTradeSession(profile.trade.session)) return;
  const accRepo = repoOf(profile.id);
  const account = await accRepo.get();
  if (!account.initialized) return;

  const held = new Set(account.positions.map((p) => toFullCode(p.symbol)));
  const pool = profile.selection.universe === 'watchlist' ? await resolvePool(profile) : [];
  const quoteSyms = Array.from(new Set([...pool.map((s) => toFullCode(s)), ...held]));

  // 行情：优先复用 QuoteFeed 本轮刚推送的快照（5s 一轮已经批量拉过一次），
  // 仅对快照未覆盖的缺失标的补拉，避免「每轮每个策略各发一次批量行情」放大 QPS。
  const quoteByKey = new Map<string, Quote>();
  if (quoteSyms.length > 0) {
    const feedByKey = new Map<string, Quote>();
    for (const q of feedQuotes ?? []) feedByKey.set(toFullCode(q.symbol), q);
    const symObjs = quoteSyms
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
    if (needFetch.length > 0) {
      try {
        const fetched = await marketData.getQuotes(needFetch);
        for (const q of fetched) quoteByKey.set(toFullCode(q.symbol), q);
      } catch {
        // 补拉失败继续：下方缺失 quote 的标的自然跳过
      }
    }
  }

  // ---- 持仓：止盈/止损/移动止损/卖出信号 ----
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
      if (hit) {
        reason = hit.reason;
      } else if (checkTrailingStop(peak, quote.last, profile.exit.trailingPct)) {
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

  // ---- 空仓名额内：选股过滤 + 买入信号 ----
  const freshAcc = await accRepo.get();
  const freshHeld = new Set(freshAcc.positions.map((p) => toFullCode(p.symbol)));
  if (freshHeld.size >= profile.trade.maxPositions) return;
  if (profile.trade.maxPositions <= 0) return;

  for (const symbol of pool) {
    if (freshHeld.size >= profile.trade.maxPositions) break;
    const symKey = toFullCode(symbol);
    if (freshHeld.has(symKey)) continue;
    const quote = quoteByKey.get(symKey);
    if (!passesSelection(profile.selection, quote ?? null)) continue;

    const candles = await fetchCandles(profile, symbol);
    if (candles.length === 0) continue;
    const latestBar = String(candles[candles.length - 1].datetime);
    if (lastOrderBar.get(closeKey(profile.id, symKey)) === latestBar) continue; // 同 bar 防重
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
    const actives = profiles.filter((p) => p.enabled && p.autoTrade);
    for (const p of actives) {
      try {
        await runProfile(p, feedQuotes ?? null);
      } catch {
        // 单策略异常不影响其它策略
      }
    }
    // 增量订阅自动交易选股池（QuoteFeed 常驻轮询，独立于页面）
    if (actives.length > 0) {
      const poolSyms: Symbol[] = [];
      for (const p of actives) {
        for (const s of await resolvePool(p)) {
          const k = toFullCode(s);
          if (!subscribedPool.has(k)) {
            subscribedPool.add(k);
            poolSyms.push(s);
          }
        }
      }
      if (poolSyms.length > 0) quoteFeed.subscribe(poolSyms);
    }
  } finally {
    processing = false;
  }
}

/** 启动自动交易运行时（幂等）。 */
export function startStrategyEngine(): void {
  if (started) return;
  started = true;
  unsubscribe = quoteFeed.subscribeListener((_symbols, quotes) => {
    // 直接复用 QuoteFeed 本轮行情快照，避免策略每轮重复批量请求行情
    tick(quotes).catch(() => undefined);
  });
  // 冷启动若处于交易时段，立刻跑一轮（行情轮询本身也会驱动）
  tick().catch(() => undefined);
}

export function stopStrategyEngine(): void {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
}
