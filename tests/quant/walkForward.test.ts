import { splitCandles, walkForward } from '@/quant/walkForward';
import type { ProfileEvaluator } from '@/quant/profile';
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

const strat: ProfileEvaluator = (candles: Candle[]) => {
  const last = candles[candles.length - 1].close;
  if (last >= 105) return { side: 'buy', reason: 'up', strength: 2 };
  if (last <= 95) return { side: 'sell', reason: 'down', strength: -2 };
  return { side: 'hold', reason: '', strength: 0 };
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
    const r = splitCandles(cs, { minTrainBars: 30, minValBars: 10 });
    expect(r.ok).toBe(false);
  });
});

describe('walkForward', () => {
  it('样本不足返回 null', () => {
    expect(walkForward(strat, series([100, 101]))).toBeNull();
  });

  it('返回训练/验证两段结果', () => {
    const cs = series(Array.from({ length: 80 }, (_, i) => 90 + (i % 20)));
    const r = walkForward(strat, cs, { trainRatio: 0.6 });
    expect(r).toBeTruthy();
    expect(r!.train).toBeTruthy();
    expect(r!.val).toBeTruthy();
  });
});
