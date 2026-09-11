/**
 * SignalEngine —— 信号计算驱动（常驻）。
 *
 * 监听 QuoteFeed 的行情刷新（每 5s 一轮，快照随回调下发）：
 *  - 直接复用轮询快照里的 Quote，不再为每个标的重复发单标的行情请求；
 *  - 单标的 K 线重算做节流：30s 内且价格未变的标的直接跳过，
 *    盘中价格变动频繁时 ≈ 每标的 1 次 K 线请求/30s（原实现为每 5s 2 次请求/标的）。
 *  - 结果写入 SignalStore 供主页/量化页读取。仅在交易时段随行情刷新触发。
 */
import type { Quote, Symbol } from '@/data/api';
import { marketData } from '@/data/api';
import { quoteFeed } from '@/data/QuoteFeed';
import { computeSignal, type TradeSignal } from './signals';
import { saveSignal, loadStrategyConfig } from './SignalStore';
import { signalToAlertEvent } from './signalAlerts';
import { recordAlerts } from '@/features/watchlist/alertHistory';
import { getMutedSignalStrategies } from '@/features/watchlist/userAlertRules';

let started = false;

/** 信号告警回调（由 AlertCenter 注入，类似 watchlistPoller.setNotifier） */
let signalNotifier: ((events: import('@/features/watchlist/alerts').AlertEvent[]) => void) | null = null;

export function setSignalNotifier(fn: ((events: import('@/features/watchlist/alerts').AlertEvent[]) => void) | null): void {
  signalNotifier = fn;
}

/** 单标的 K 线级重算的最小间隔：信号随日 K 变化，无需每个轮询周期都重算 */
const RECOMPUTE_MIN_MS = 30_000;

interface RecomputeState {
  at: number;
  lastQuote: number | null;
}

const stateByKey = new Map<string, RecomputeState>();

function keyOf(s: Symbol): string {
  return `${s.code}.${s.exchange}`;
}

export function startSignalEngine(): void {
  if (started) return;
  started = true;
  quoteFeed.onQuote = (symbols, quotes) => {
    recompute(symbols, quotes);
  };
}

export function stopSignalEngine(): void {
  if (quoteFeed.onQuote) quoteFeed.onQuote = null;
  started = false;
}

async function recompute(symbols: Symbol[], snapshot: Quote[]): Promise<void> {
  const cfg = await loadStrategyConfig();
  const quoteByKey = new Map<string, Quote>();
  for (const q of snapshot ?? []) quoteByKey.set(keyOf(q.symbol), q);

  const now = Date.now();
  const newSignals: TradeSignal[] = [];
  for (const sym of symbols) {
    const k = keyOf(sym);
    const quote = quoteByKey.get(k);
    if (!quote || quote.last <= 0) continue;

    // 节流：30s 内且价格未变 → 跳过（避免每轮都对同一标的拉 K 线）
    const prev = stateByKey.get(k);
    if (prev && now - prev.at < RECOMPUTE_MIN_MS && prev.lastQuote === quote.last) continue;

    try {
      const candles = await marketData.getKline({ symbol: sym, period: 'day', startMs: now - 400 * 86400_000, endMs: now });
      if (!candles || candles.length < 2) continue;
      const sig: TradeSignal = computeSignal(sym, candles, quote, cfg);
      saveSignal(sig);
      newSignals.push(sig);
      stateByKey.set(k, { at: now, lastQuote: quote.last });
    } catch {
      // 单标的计算失败跳过，不影响其余
    }
  }

  // 信号告警：buy/sell → AlertEvent → 落盘 + 通知中心（可按策略静音）
  if (newSignals.length > 0 && signalNotifier) {
    const muted = await getMutedSignalStrategies().catch(() => new Set<string>());
    const alertEvents = newSignals
      .map((s) => signalToAlertEvent(s))
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .filter((e) => {
        if (muted.size === 0) return true;
        const sid = e.ruleId.startsWith('signal_') ? e.ruleId.slice('signal_'.length) : '';
        return !muted.has(sid);
      });
    if (alertEvents.length > 0) {
      // 去重后落盘（同天同标的同策略只记一次）
      recordAlerts(alertEvents).catch(() => {});
      signalNotifier(alertEvents);
    }
  }
}
