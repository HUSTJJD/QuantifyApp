import { expandGrid, gridSearch, bestParams } from '@/quant/optimize';
import type { ProfileEvaluator } from '@/quant/profile';
import type { ParamCombo } from '@/quant/optimize';
import type { Candle } from '@/data/api';

function candle(close: number, i: number): Candle {
  return {
    datetime: `2024-01-${String(i + 1).padStart(2, '0')}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  };
}

const candles: Candle[] = Array.from({ length: 60 }, (_, i) => candle(100 + i, i));

function makeEvaluate(params: ParamCombo): ProfileEvaluator {
  return (cs) => {
    const last = cs[cs.length - 1].close;
    return last > params.threshold
      ? { side: 'buy', reason: '', strength: 1 }
      : { side: 'sell', reason: '', strength: -1 };
  };
}

describe('expandGrid', () => {
  it('笛卡尔积', () => {
    const combos = expandGrid({ a: [1, 2], b: [10, 20] });
    expect(combos).toHaveLength(4);
    expect(combos).toContainEqual({ a: 1, b: 10 });
    expect(combos).toContainEqual({ a: 2, b: 20 });
  });
  it('空网格返回单组空对象', () => {
    expect(expandGrid({})).toEqual([{}]);
  });
});

describe('gridSearch / bestParams', () => {
  it('遍历网格并排序', () => {
    const grid = { threshold: [80, 100, 120] };
    const all = gridSearch(makeEvaluate, candles, grid, { initCash: 100000 });
    expect(all).toHaveLength(3);
  });

  it('bestParams 返回得分最高项', () => {
    const grid = { threshold: [80, 100, 120] };
    const best = bestParams(makeEvaluate, candles, grid, { initCash: 100000 });
    expect(best).toBeTruthy();
    expect(best!.params.threshold).toBeGreaterThanOrEqual(80);
  });
});
