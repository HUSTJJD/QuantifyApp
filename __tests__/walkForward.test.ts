import { splitCandles, walkForward } from '@/quant/walkForward';
import type { Strategy } from '@/quant/strategies';
import type { Candle } from '@/data/api';

function series(prices: number[]): Candle[] {
  return prices.map((p, i) => ({
    datetime: i,
    open: p,
    high: p + 1,
    low: p - 1,
    close: p,
    volume: 1000,
    amount: p * 1000,
  }));
}

// 简单策略：价格 > 105 买，< 95 卖
const strat: Strategy = {
  id: 'test',
  label: 'test',
  enabledByDefault: true,
  evaluate: (candles: Candle[]) => {
    const last = candles[candles.length - 1].close;
    if (last >= 105) return { side: 'buy', reason: 'up', strength: 2 };
    if (last <= 95) return { side: 'sell', reason: 'down', strength: -2 };
    return { side: 'hold', reason: '', strength: 0 };
  },
};

describe('splitCandles', () => {
  it('按比例切分', () => {
    const cs = series(Array.from({ length: 100 }, (_, i) => 100 + i));
    const r = splitCandles(cs, { trainRatio: 0.7 });
    expect(r.ok).toBe(true);
    expect(r.train).toHaveLength(70);
    expect(r.val).toHaveLength(30);
  });

  it('K 线不足返回失败', () => {
    const cs = series([100, 101, 102]);
    const r = splitCandles(cs);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('不足');
  });

  it('训练集不足返回失败', () => {
    const cs = series(Array.from({ length: 40 }, (_, i) => 100 + i));
    const r = splitCandles(cs, { trainRatio: 0.1, minTrainBars: 30 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('训练集');
  });

  it('验证集不足返回失败', () => {
    const cs = series(Array.from({ length: 40 }, (_, i) => 100 + i));
    const r = splitCandles(cs, { trainRatio: 0.95, minValBars: 10 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('验证集');
  });

  it('训练集在前、验证集在后', () => {
    const cs = series(Array.from({ length: 100 }, (_, i) => 100 + i));
    const r = splitCandles(cs, { trainRatio: 0.5 });
    expect(r.train[r.train.length - 1].close).toBeLessThan(r.val[0].close);
  });
});

describe('walkForward', () => {
  it('K 线不足返回 null', () => {
    expect(walkForward(strat, series([100, 101]))).toBeNull();
  });

  it('上涨区间：训练集和验证集都盈利', () => {
    // 持续上涨，策略会买入持有
    const cs = series(Array.from({ length: 200 }, (_, i) => 100 + i * 0.5));
    const r = walkForward(strat, cs, { trainRatio: 0.6 });
    expect(r).not.toBeNull();
    expect(r!.train.totalReturnPct).toBeGreaterThan(0);
    expect(r!.val.totalReturnPct).toBeGreaterThan(0);
    expect(r!.likelyOverfit).toBe(false);
  });

  it('过拟合场景：训练盈利 + 验证亏损 → likelyOverfit', () => {
    // 训练段上涨（触发买），验证段下跌（持仓亏损）
    const trainPart = Array.from({ length: 120 }, (_, i) => 100 + i); // 100→219
    const valPart = Array.from({ length: 80 }, (_, i) => 220 - i * 2); // 220→62
    const cs = series([...trainPart, ...valPart]);
    const r = walkForward(strat, cs, { trainRatio: 0.6 });
    expect(r).not.toBeNull();
    expect(r!.train.totalReturnPct).toBeGreaterThan(0);
    expect(r!.val.totalReturnPct).toBeLessThan(0);
    expect(r!.likelyOverfit).toBe(true);
    expect(r!.returnDecayPct).toBeGreaterThan(100);
  });

  it('衰减率计算正确', () => {
    const trainPart = Array.from({ length: 120 }, (_, i) => 100 + i);
    const valPart = Array.from({ length: 80 }, (_, i) => 220 - i * 2);
    const cs = series([...trainPart, ...valPart]);
    const r = walkForward(strat, cs, { trainRatio: 0.6 });
    expect(r).not.toBeNull();
    // decay = (train - val) / |train| * 100
    const expected = ((r!.train.totalReturnPct - r!.val.totalReturnPct) / Math.abs(r!.train.totalReturnPct)) * 100;
    expect(r!.returnDecayPct).toBeCloseTo(expected, 5);
  });
});
