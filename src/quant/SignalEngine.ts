/**
 * SignalEngine —— 信号计算驱动（常驻）。
 *
 * 监听 QuoteFeed 的行情刷新（每 5s 一轮，快照随回调下发）：
 *  - 直接复用轮询快照里的 Quote，不再为每个标的重复发单标的行情请求；
 *  - 单标的 K 线重算做节流：30s 内且价格未变的标的直接跳过，
 *    盘中价格变动频繁时 ≈ 每标的 1 次 K 线请求/30s（原实现为每 5s 2 次请求/标的）。
 *  - 结果写入 SignalStore 供主页/量化页读取。仅在交易时段随行情刷新触发。
 */
import type { Quote, Symbol } from '@/api';
import { marketData } from '@/api';
import { quoteFeed } from '@/services/QuoteFeed';
import { computeSignal, type TradeSignal } from './signals';
import { saveSignal, loadStrategyConfig } from './SignalStore';

let started = false;

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
      stateByKey.set(k, { at: now, lastQuote: quote.last });
    } catch {
      // 单标的计算失败跳过，不影响其余
    }
  }
}
