/**
 * 复权计算引擎 + 周期聚合单测。
 * 验证：前复权/后复权系数、复权 K 线 OHLC、周/月 K 聚合 OHLCV。
 */
import { adjustCandles, computeForwardFactors, computeBackwardFactors } from '@/quant/adjustment';
import { aggregateWeekly, aggregateMonthly } from '@/quant/aggregate';
import type { Candle } from '@/data/api';

function candle(datetime: number | string, o: number, h: number, l: number, c: number, volume = 100): Candle {
  return { datetime, open: o, high: h, low: l, close: c, volume };
}

describe('复权计算', () => {
  // 3 根日 K：2024-01-02/03/04；第 2 根后有 10 送 1（perShareBonus=0.1）
  const candles: Candle[] = [
    candle('2024-01-02', 10, 11, 9, 10),
    candle('2024-01-03', 10, 12, 10, 11),
    candle('2024-01-04', 11, 13, 11, 12),
  ];
  const factor = { exDateMs: new Date('2024-01-03T00:00:00+08:00').getTime(), perShareBonus: 0.1 };

  it('无因子时系数全 1', () => {
    expect(computeForwardFactors(candles, [])).toEqual([1, 1, 1]);
    expect(computeBackwardFactors(candles, [])).toEqual([1, 1, 1]);
  });

  it('前复权：除权日之前的 bar 系数 > 1（价格被上调），之后的保持 1', () => {
    const coef = computeForwardFactors(candles, [factor]);
    // 1 月 2 日早于除权日(1/3)：系数 = 1 + 0.1 = 1.1；1/3 当天含除权日起系数为 1
    expect(coef[0]).toBeCloseTo(1.1, 5);
    expect(coef[1]).toBeCloseTo(1, 5);
    expect(coef[2]).toBeCloseTo(1, 5);
  });

  it('后复权：除权日当天及之后系数连乘，之前为 1', () => {
    const coef = computeBackwardFactors(candles, [factor]);
    expect(coef[0]).toBeCloseTo(1, 5);
    expect(coef[1]).toBeCloseTo(1.1, 5);
    expect(coef[2]).toBeCloseTo(1.1, 5);
  });

  it('adjustCandles none 原样；forward/backward 正确缩放 OHLC', () => {
    const none = adjustCandles(candles, [factor], 'none');
    expect(none).toBe(candles);
    const fwd = adjustCandles(candles, [factor], 'forward');
    expect(fwd[0].close).toBeCloseTo(10 * 1.1, 5);
    expect(fwd[0].high).toBeCloseTo(11 * 1.1, 5);
    expect(fwd[0].low).toBeCloseTo(9 * 1.1, 5);
    expect(fwd[0].open).toBeCloseTo(10 * 1.1, 5);
    expect(fwd[1].close).toBe(11);
    const bwd = adjustCandles(candles, [factor], 'backward');
    expect(bwd[2].close).toBeCloseTo(12 * 1.1, 5);
    expect(bwd[0].close).toBe(10);
  });

  it('现金分红折算为比例（divRatio = 分红/收盘）', () => {
    const cashFactor = { exDateMs: new Date('2024-01-03T00:00:00+08:00').getTime(), dividendPerShare: 1 };
    const coef = computeForwardFactors(candles, [cashFactor]);
    // 1/3 之前：1 + 1/10 = 1.1（用 1/2 收盘价 10 折算）
    expect(coef[0]).toBeCloseTo(1.1, 5);
  });
});

describe('周期聚合', () => {
  it('周 K：周内聚合 OHLCV', () => {
    // 2024-01-01 是周一
    const daily: Candle[] = [
      candle('2024-01-01', 10, 11, 9, 10, 100),
      candle('2024-01-02', 10, 13, 9, 12, 200),
      candle('2024-01-03', 12, 12, 10, 11, 150),
      // 下一周
      candle('2024-01-08', 11, 14, 10, 13, 300),
    ];
    const weekly = aggregateWeekly(daily);
    expect(weekly).toHaveLength(2);
    expect(weekly[0].open).toBe(10);
    expect(weekly[0].high).toBe(13);
    expect(weekly[0].low).toBe(9);
    expect(weekly[0].close).toBe(11);
    expect(weekly[0].volume).toBe(450);
    expect(weekly[1].close).toBe(13);
    expect(weekly[1].volume).toBe(300);
  });

  it('月 K：按自然月聚合', () => {
    const daily: Candle[] = [
      candle('2024-01-02', 10, 11, 9, 10, 100),
      candle('2024-01-31', 10, 12, 10, 11, 200),
      candle('2024-02-01', 11, 13, 10, 12, 300),
    ];
    const monthly = aggregateMonthly(daily);
    expect(monthly).toHaveLength(2);
    expect(monthly[0].open).toBe(10);
    expect(monthly[0].close).toBe(11);
    expect(monthly[0].volume).toBe(300);
    expect(monthly[1].close).toBe(12);
  });

  it('空输入返回空', () => {
    expect(aggregateWeekly([])).toEqual([]);
    expect(aggregateMonthly([])).toEqual([]);
  });
});
