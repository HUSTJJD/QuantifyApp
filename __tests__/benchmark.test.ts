import { alignByDate, computeBenchmarkMetrics } from '@/quant/benchmark';
import type { Candle } from '@/data/api';

function series(prices: number[], startMs = 1700000000000): Candle[] {
  return prices.map((p, i) => ({
    datetime: startMs + i * 86400_000,
    open: p,
    high: p + 1,
    low: p - 1,
    close: p,
    volume: 1000,
    amount: p * 1000,
  }));
}

describe('alignByDate', () => {
  it('按日期对齐并归一化到 100', () => {
    const strategyCs = series([100, 110, 120]);
    const equity = [100_000, 110_000, 120_000];
    const benchCs = series([200, 220, 240]);
    const points = alignByDate(equity, strategyCs, benchCs);
    expect(points).toHaveLength(3);
    expect(points[0].strategyNav).toBeCloseTo(100);
    expect(points[0].benchmarkNav).toBeCloseTo(100);
    expect(points[2].strategyNav).toBeCloseTo(120);
    expect(points[2].benchmarkNav).toBeCloseTo(120);
  });

  it('基准缺失的日期跳过', () => {
    const strategyCs = series([100, 110, 120]);
    const equity = [100_000, 110_000, 120_000];
    const benchCs = series([200, 220]); // 少一根
    const points = alignByDate(equity, strategyCs, benchCs);
    expect(points).toHaveLength(2);
  });

  it('空输入返回空', () => {
    expect(alignByDate([], [], [])).toHaveLength(0);
  });
});

describe('computeBenchmarkMetrics', () => {
  it('策略与基准同步上涨：超额 ≈ 0', () => {
    const strategyCs = series([100, 110, 120]);
    const equity = [100_000, 110_000, 120_000];
    const benchCs = series([200, 220, 240]); // 同比例
    const points = alignByDate(equity, strategyCs, benchCs);
    const m = computeBenchmarkMetrics(points);
    expect(m.excessReturnPct).toBeCloseTo(0, 5);
  });

  it('策略跑赢基准：超额 > 0', () => {
    const strategyCs = series([100, 120, 140]);
    const equity = [100_000, 120_000, 140_000]; // +40%
    const benchCs = series([200, 210, 220]); // +10%
    const points = alignByDate(equity, strategyCs, benchCs);
    const m = computeBenchmarkMetrics(points);
    expect(m.excessReturnPct).toBeCloseTo(30, 5);
  });

  it('策略跑输基准：超额 < 0', () => {
    const strategyCs = series([100, 105, 110]);
    const equity = [100_000, 105_000, 110_000]; // +10%
    const benchCs = series([200, 220, 240]); // +20%
    const points = alignByDate(equity, strategyCs, benchCs);
    const m = computeBenchmarkMetrics(points);
    expect(m.excessReturnPct).toBeLessThan(0);
  });

  it('少于 2 个点返回全 0', () => {
    expect(computeBenchmarkMetrics([]).excessReturnPct).toBe(0);
  });
});
