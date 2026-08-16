/**
 * SignalEngine —— 信号计算驱动（常驻）。
 * 监听 QuoteFeed 的行情刷新：每次行情更新后，对订阅标的拉取日 K 线并跑信号引擎，
 * 结果写入 SignalStore 供主页/量化页读取。仅在交易时段随行情刷新触发。
 */
import type { Symbol } from '@/api';
import { marketData } from '@/api';
import { quoteFeed } from '@/services/QuoteFeed';
import { computeSignal, type TradeSignal } from './signals';
import { saveSignal, loadStrategyConfig } from './SignalStore';

let started = false;

export function startSignalEngine(): void {
  if (started) return;
  started = true;
  quoteFeed.onQuote = (symbols: Symbol[]) => {
    recompute(symbols);
  };
}

export function stopSignalEngine(): void {
  if (quoteFeed.onQuote) quoteFeed.onQuote = null;
  started = false;
}

async function recompute(symbols: Symbol[]): Promise<void> {
  const cfg = await loadStrategyConfig();
  for (const sym of symbols) {
    try {
      const now = Date.now();
      const candles = await marketData.getKline({ symbol: sym, period: 'day', startMs: now - 400 * 86400_000, endMs: now });
      if (!candles || candles.length < 2) continue;
      const quote = (await marketData.getQuotes([sym]))[0] ?? null;
      const sig: TradeSignal = computeSignal(sym, candles, quote, cfg);
      saveSignal(sig);
    } catch {
      // 单标的计算失败跳过，不影响其余
    }
  }
}
