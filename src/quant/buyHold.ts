/**
 * 买入持有基准：同一段 K 线、初始资金全仓买入并持有到期。
 * 用于回答「策略是否跑赢简单拿着这只票」。
 */
import type { Candle } from '@/data/api';

export interface BuyHoldMetrics {
  /** 买入持有总收益 % */
  totalReturnPct: number;
  /** 权益序列（与 candles 等长） */
  equity: number[];
  /** 首日可买股数（整手） */
  shares: number;
  buyPrice: number;
}

export function runBuyHold(
  candles: Candle[],
  initCash = 100_000,
  lotSize = 100,
  /** 首日买入费用（可选，0 表示忽略） */
  fee = 0,
): BuyHoldMetrics {
  if (candles.length === 0 || initCash <= 0) {
    return { totalReturnPct: 0, equity: [], shares: 0, buyPrice: 0 };
  }
  const p0 = candles[0].close;
  if (!(p0 > 0)) {
    return { totalReturnPct: 0, equity: candles.map(() => initCash), shares: 0, buyPrice: 0 };
  }
  const budget = initCash - fee;
  const shares = Math.max(0, Math.floor(budget / p0 / lotSize) * lotSize);
  const cost = shares * p0 + fee;
  const cash0 = initCash - cost;
  const equity = candles.map((c) => cash0 + shares * c.close);
  const finalEq = equity[equity.length - 1];
  return {
    totalReturnPct: ((finalEq - initCash) / initCash) * 100,
    equity,
    shares,
    buyPrice: p0,
  };
}

/** 策略相对买入持有的超额收益（百分点） */
export function excessVsBuyHold(strategyReturnPct: number, buyHoldReturnPct: number): number {
  return strategyReturnPct - buyHoldReturnPct;
}
