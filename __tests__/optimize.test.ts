import { expandGrid, gridSearch, bestParams, scoreOf, type ParamCombo } from '@/quant/optimize';
import { runBacktest } from '@/quant/backtest';
import type { Strategy } from '@/quant/strategies';
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

// 上升趋势行情：越靠后越高
const candles: Candle[] = Array.from({ length: 60 }, (_, i) => candle(100 + i, i));

/** 简单策略：close > threshold 时买入，否则卖出。 */
function makeStrategy(params: ParamCombo): Strategy {
  return {
    id: 'test',
    label: 'test',
    enabledByDefault: true,
    evaluate: (cs) => {
      const last = cs[cs.length - 1].close;
      return last > params.threshold ? { side: 'buy', reason: '', strength: 1 } : { side: 'sell', reason: '', strength: -1 };
    },
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
  it('按 totalReturnPct 选最优参数', () => {
    const grid = { threshold: [80, 100, 120] };
    const best = bestParams(makeStrategy, candles, grid, { initCash: 100000 })!;
    expect(best).not.toBeNull();
    // threshold 越低越早上车，趋势行情下收益更高
    expect(best.params.threshold).toBe(80);
    expect(best.score).toBeGreaterThan(0);
  });

  it('返回全部组合并按 score 降序', () => {
    const grid = { threshold: [80, 100, 120] };
    const all = gridSearch(makeStrategy, candles, grid, { initCash: 100000 });
    expect(all).toHaveLength(3);
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].score).toBeGreaterThanOrEqual(all[i].score);
    }
  });

  it('topN 截断', () => {
    const grid = { threshold: [80, 100, 120] };
    const top = gridSearch(makeStrategy, candles, grid, { initCash: 100000, topN: 1 });
    expect(top).toHaveLength(1);
  });

  it('scoreOf 取不同指标', () => {
    const r = runBacktest(makeStrategy({ threshold: 80 }), candles, { initCash: 100000 });
    expect(scoreOf(r, 'totalReturnPct')).toBe(r.totalReturnPct);
    expect(scoreOf(r, 'sharpe')).toBe(r.sharpe);
    expect(scoreOf(r, 'winRate')).toBe(r.winRate);
    expect(scoreOf(r, 'finalEquity')).toBe(r.finalEquity);
  });
});
