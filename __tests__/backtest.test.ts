import { runBacktest } from '@/quant/backtest';
import type { Strategy } from '@/quant/strategies';
import type { Candle } from '@/api';

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

// 自定义策略：价格首次涨破 105 买入，跌破 95 卖出
const custom: Strategy = {
  id: 'custom',
  label: '测试',
  enabledByDefault: true,
  evaluate: (candles: Candle[]) => {
    const last = candles[candles.length - 1].close;
    if (last >= 105) return { side: 'buy', reason: 'up', strength: 2 };
    if (last <= 95) return { side: 'sell', reason: 'down', strength: -2 };
    return { side: 'hold', reason: '', strength: 0 };
  },
};

describe('runBacktest', () => {
  it('权益曲线与 K 线等长', () => {
    const cs = series([100, 101, 102, 103, 104, 105, 106, 95, 94, 96]);
    const r = runBacktest(custom, cs);
    expect(r.equity.length).toBe(cs.length);
    expect(r.initCash).toBe(100_000);
  });

  it('金叉策略在上涨序列产生买入交易', () => {
    // 先跌后涨，制造 MA 金叉
    const goldenCross: Strategy = {
      id: 'gc',
      label: '金叉',
      enabledByDefault: true,
      evaluate: (candles: Candle[]) => {
        if (candles.length < 6) return { side: 'hold', reason: '', strength: 0 };
        const c = candles.map((x: Candle) => x.close);
        const ma = (arr: number[], n: number) => arr.slice(-n).reduce((s, v) => s + v, 0) / n;
        const fast = ma(c, 3);
        const slow = ma(c, 5);
        const fastPrev = ma(c.slice(0, -1), 3);
        const slowPrev = ma(c.slice(0, -1), 5);
        if (fastPrev <= slowPrev && fast > slow) return { side: 'buy', reason: '金叉', strength: 2 };
        if (fastPrev >= slowPrev && fast < slow) return { side: 'sell', reason: '死叉', strength: -2 };
        return { side: 'hold', reason: '', strength: 0 };
      },
    };
    const cs = series([10, 9, 8, 7, 6, 7, 8, 9, 10, 11, 12, 13]);
    const r = runBacktest(goldenCross, cs, { initCash: 100_000 });
    expect(r.trades.some((t) => t.side === 'buy')).toBe(true);
  });

  it('自定义策略：涨破105买入、跌破95卖出，产生一买一卖', () => {
    const cs = series([100, 101, 102, 104, 106, 108, 100, 96, 94, 90]);
    const r = runBacktest(custom, cs);
    const buys = r.trades.filter((t) => t.side === 'buy');
    const sells = r.trades.filter((t) => t.side === 'sell');
    expect(buys.length).toBeGreaterThanOrEqual(1);
    expect(sells.length).toBeGreaterThanOrEqual(1);
    // 买入后持仓股数为整手
    expect(buys[0].shares % 100).toBe(0);
    // 手续费为正
    expect(buys[0].fee).toBeGreaterThan(0);
  });

  it('绩效指标计算合理', () => {
    const cs = series([100, 101, 102, 104, 106, 108, 110, 112, 114, 116]);
    const r = runBacktest(custom, cs);
    expect(r.totalReturnPct).toBeGreaterThan(0);
    expect(r.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.sharpe)).toBe(true);
    expect(r.winRate).toBeGreaterThanOrEqual(0);
    expect(r.winRate).toBeLessThanOrEqual(100);
  });

  it('空 K 线不抛错，返回初始权益', () => {
    const r = runBacktest(custom, []);
    expect(r.equity).toEqual([]);
    expect(r.finalEquity).toBe(100_000);
    expect(r.trades).toEqual([]);
  });

  it('无信号（全 hold）不产生交易', () => {
    const hold: Strategy = { id: 'h', label: 'h', enabledByDefault: true, evaluate: () => ({ side: 'hold', reason: '', strength: 0 }) };
    const cs = series([100, 100, 100, 100, 100]);
    const r = runBacktest(hold, cs);
    expect(r.trades).toEqual([]);
    expect(r.equity.every((e) => e === 100_000)).toBe(true);
  });
});
