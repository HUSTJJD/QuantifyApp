import { runBacktest } from '@/quant/backtest';
import { gridSearch } from '@/quant/optimize';
import { walkForward } from '@/quant/walkForward';
import type { ProfileEvaluator } from '@/quant/profile';
import type { Candle } from '@/data/api';
import {
  annualizedReturnPct,
  barsPerYearOfPeriod,
  calmarRatio,
  maxDrawdownDetail,
  sharpeRatio,
  totalReturnPct,
} from '@/quant/metrics';

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

/** 首根 bar 买入，第 total 根 bar 卖出 */
function buyFirstSellLast(total: number): ProfileEvaluator {
  return (candles: Candle[]) => {
    if (candles.length === 1) return { side: 'buy', reason: 'first', strength: 2 };
    if (candles.length === total) return { side: 'sell', reason: 'last', strength: -2 };
    return { side: 'hold', reason: '', strength: 0 };
  };
}

describe('backtest engine metrics', () => {
  it('首买末卖可完成回测并返回权益序列', () => {
    const cs = series([100, 101, 102, 103, 104]);
    const r = runBacktest(buyFirstSellLast(4), cs, { initCash: 100_000, execution: 'close' });
    expect(r.equity).toHaveLength(cs.length);
    expect(r.finalEquity).toBeGreaterThan(0);
  });

  it('metrics helpers accept equity series', () => {
    const equity = [100, 110, 105, 120];
    expect(typeof totalReturnPct(equity)).toBe('number');
    expect(typeof annualizedReturnPct(equity, 252)).toBe('number');
    expect(typeof sharpeRatio(equity, 252)).toBe('number');
    const dd = maxDrawdownDetail(equity);
    expect(dd.maxDdPct).toBeGreaterThanOrEqual(0);
    expect(typeof calmarRatio(totalReturnPct(equity), dd.maxDdPct)).toBe('number');
  });

  it('barsPerYearOfPeriod maps periods', () => {
    expect(barsPerYearOfPeriod('day')).toBeGreaterThan(0);
    expect(barsPerYearOfPeriod('1m')).toBeGreaterThan(barsPerYearOfPeriod('day'));
  });

  it('gridSearch 与 walkForward 可运行', () => {
    const cs = series(Array.from({ length: 40 }, (_, i) => 90 + (i % 15)));
    const strat = buyFirstSellLast(11);
    const wf = walkForward(strat, cs, { initCash: 10_000, trainRatio: 0.6 });
    expect(wf === null || wf.train !== undefined).toBe(true);
    const [best] = gridSearch(() => strat, cs, { foo: [1] }, { initCash: 10_000 });
    expect(best).toBeTruthy();
  });
});
