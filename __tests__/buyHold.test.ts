/**
 * 买入持有基准单测。
 */
import { runBuyHold, excessVsBuyHold } from '@/quant/buyHold';
import type { Candle } from '@/data/api';

function series(prices: number[]): Candle[] {
  return prices.map((p, i) => ({
    datetime: i,
    open: p,
    high: p,
    low: p,
    close: p,
    volume: 1000,
  }));
}

describe('runBuyHold', () => {
  it('上涨序列收益为正且权益等长', () => {
    const r = runBuyHold(series([100, 110, 120]), 100_000);
    expect(r.equity).toHaveLength(3);
    expect(r.totalReturnPct).toBeCloseTo(20, 1);
    expect(r.shares).toBe(1000);
  });

  it('空序列安全', () => {
    const r = runBuyHold([], 100_000);
    expect(r.totalReturnPct).toBe(0);
  });

  it('超额 = 策略 - 买入持有', () => {
    expect(excessVsBuyHold(15, 20)).toBeCloseTo(-5);
  });
});
