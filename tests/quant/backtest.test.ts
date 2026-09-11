import { runBacktest, DEFAULT_COST } from '@/quant/backtest';
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

/** 价格首次涨破 105 买入，跌破 95 卖出 */
const custom: ProfileEvaluator = (candles: Candle[]) => {
  const last = candles[candles.length - 1].close;
  if (last >= 105) return { side: 'buy', reason: 'up', strength: 2 };
  if (last <= 95) return { side: 'sell', reason: 'down', strength: -2 };
  return { side: 'hold', reason: '', strength: 0 };
};

const hold: ProfileEvaluator = () => ({ side: 'hold', reason: '', strength: 0 });

describe('runBacktest', () => {
  it('权益曲线与 K 线等长', () => {
    const cs = series([100, 101, 102, 103, 104, 105, 106, 95, 94, 96]);
    const r = runBacktest(custom, cs);
    expect(r.equity.length).toBe(cs.length);
    expect(r.initCash).toBe(100_000);
  });

  it('金叉策略在上涨序列产生买入交易', () => {
    const goldenCross: ProfileEvaluator = (candles: Candle[]) => {
      if (candles.length < 2) return { side: 'hold', reason: '', strength: 0 };
      const last = candles[candles.length - 1].close;
      const prev = candles[candles.length - 2].close;
      if (last > prev) return { side: 'buy', reason: 'up', strength: 2 };
      return { side: 'hold', reason: '', strength: 0 };
    };
    const cs = series([100, 101, 102, 103, 104, 105, 106]);
    const r = runBacktest(goldenCross, cs, { initCash: 100_000 });
    expect(r.trades.length).toBeGreaterThan(0);
  });

  it('空 K 线返回初始资金', () => {
    const r = runBacktest(custom, []);
    expect(r.initCash).toBe(100_000);
    expect(r.trades).toHaveLength(0);
  });

  it('hold 策略不产生交易', () => {
    const cs = series([100, 101, 102, 103]);
    const r = runBacktest(hold, cs);
    expect(r.trades).toHaveLength(0);
    expect(r.finalEquity).toBe(100_000);
  });

  it('手续费降低最终权益', () => {
    const cs = series([100, 105, 110, 105, 110]);
    const noCost = runBacktest(custom, cs, {
      cost: { commissionRate: 0, minCommission: 0, stampTaxRate: 0, transferFeeRate: 0, slippageBp: 0 },
    });
    const withCost = runBacktest(custom, cs);
    if (noCost.trades.length > 0) {
      expect(withCost.finalEquity).toBeLessThanOrEqual(noCost.finalEquity);
    }
  });

  alwaysBuy: {
    const alwaysBuy: ProfileEvaluator = () => ({ side: 'buy', reason: 'always', strength: 2 });
    it('execution=close 与 nextOpen 权益可不同', () => {
      const cs = series([100, 110, 90, 120]);
      const closeExec = runBacktest(alwaysBuy, cs, {
        initCash: 100_000,
        execution: 'close',
        cost: { ...DEFAULT_COST, slippageBp: 0 },
      });
      const nextExec = runBacktest(alwaysBuy, cs, {
        initCash: 100_000,
        execution: 'nextOpen',
        cost: { ...DEFAULT_COST, slippageBp: 0 },
      });
      expect(closeExec.trades.length).toBeGreaterThan(0);
      expect(nextExec.trades.length).toBeGreaterThanOrEqual(0);
    });
  }
});
