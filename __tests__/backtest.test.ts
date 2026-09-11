import { runBacktest, DEFAULT_COST } from '@/quant/backtest';
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
    expect(buys[0].shares % 100).toBe(0);
    expect(buys[0].fee).toBeGreaterThan(0);
  });

  it('绩效指标计算合理', () => {
    const cs = series([100, 101, 102, 104, 106, 108, 110, 112, 114, 116]);
    const r = runBacktest(custom, cs);
    expect(r.totalReturnPct).toBeGreaterThan(0);
    expect(r.annualizedReturnPct).toBeGreaterThan(0);
    expect(r.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.sharpe)).toBe(true);
    expect(r.winRate).toBeGreaterThanOrEqual(0);
    expect(r.winRate).toBeLessThanOrEqual(100);
    expect(r.profitFactor).toBeGreaterThanOrEqual(0);
    expect(r.totalFees).toBeGreaterThanOrEqual(0);
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

describe('成本模型', () => {
  const cs = series([100, 105, 110, 115, 120, 90, 85, 80]);

  it('开启费用后收益率严格下降', () => {
    const noCost = runBacktest(custom, cs, { cost: { commissionRate: 0, minCommission: 0, stampTaxRate: 0, transferFeeRate: 0 } });
    const withCost = runBacktest(custom, cs); // DEFAULT_COST
    expect(withCost.totalReturnPct).toBeLessThan(noCost.totalReturnPct);
    expect(withCost.totalFees).toBeGreaterThan(0);
    expect(noCost.totalFees).toBe(0);
  });

  it('最低佣金生效：小额交易佣金不低于 minCommission', () => {
    // 价格 100 × 100 股 = 10000 元，万 2.5 = 2.5 元 < 5 元最低
    const r = runBacktest(custom, series([100, 105, 110, 95, 90]), { cost: { ...DEFAULT_COST } });
    const buy = r.trades.find((t) => t.side === 'buy');
    if (buy) {
      // 佣金 + 过户费：佣金至少 5 元
      expect(buy.fee).toBeGreaterThanOrEqual(5);
    }
  });

  it('印花税只收卖出', () => {
    const r = runBacktest(custom, cs);
    const buy = r.trades.find((t) => t.side === 'buy');
    const sell = r.trades.find((t) => t.side === 'sell');
    if (buy && sell) {
      // 卖出费用应高于同等金额买入（多印花税）
      const buyAmount = buy.price * buy.shares;
      const sellAmount = sell.price * sell.shares;
      // 仅比较费率结构：卖出 fee/amount 应 > 买入 fee/amount（当金额相近时）
      expect(sell.fee / sellAmount).toBeGreaterThan(buy.fee / buyAmount - 0.0001);
    }
  });

  it('滑点使买价更高、卖价更低', () => {
    const noSlip = runBacktest(custom, cs, { cost: { slippageBp: 0 } });
    const withSlip = runBacktest(custom, cs, { cost: { slippageBp: 10 } }); // 10bp = 0.1%
    const buy0 = noSlip.trades.find((t) => t.side === 'buy');
    const buy1 = withSlip.trades.find((t) => t.side === 'buy');
    if (buy0 && buy1) {
      expect(buy1.price).toBeGreaterThan(buy0.price);
    }
  });
});

describe('前视防护', () => {
  it('策略只能看到当前及之前的 K 线（slice 约束）', () => {
    const seen: number[] = [];
    const spy: Strategy = {
      id: 'spy',
      label: 'spy',
      enabledByDefault: true,
      evaluate: (candles: Candle[]) => {
        seen.push(candles.length);
        return { side: 'hold', reason: '', strength: 0 };
      },
    };
    const cs = series([100, 101, 102, 103, 104, 105]);
    runBacktest(spy, cs);
    // 第 i 次调用应收到 i+1 根（0-indexed），绝不能超过当前 index+1
    expect(seen.length).toBe(cs.length);
    for (let i = 0; i < seen.length; i++) {
      expect(seen[i]).toBe(i + 1);
    }
  });

  it('策略试图读未来 bar 时不会拿到（数组已截断）', () => {
    let futureRead = false;
    const cheat: Strategy = {
      id: 'cheat',
      label: 'cheat',
      enabledByDefault: true,
      evaluate: (candles: Candle[]) => {
        // 故意读 index 100（未来），若数组未截断则能拿到
        if (candles[100] !== undefined) futureRead = true;
        return { side: 'hold', reason: '', strength: 0 };
      },
    };
    const cs = series([100, 101, 102, 103, 104, 105]);
    runBacktest(cheat, cs);
    expect(futureRead).toBe(false);
  });
});

describe('除权事件（不复权 + corporateActions）', () => {
  const start = Date.UTC(2024, 0, 2);
  function seriesMs(prices: number[]): Candle[] {
    return prices.map((p, i) => ({
      datetime: start + i * 86400_000,
      open: p,
      high: p + 1,
      low: p - 1,
      close: p,
      volume: 1000,
      amount: p * 1000,
    }));
  }

  const buyHold: Strategy = {
    id: 'bh',
    label: 'buyhold',
    enabledByDefault: true,
    evaluate: (candles: Candle[]) =>
      candles.length === 1
        ? { side: 'buy', reason: '开仓', strength: 2 }
        : { side: 'hold', reason: '', strength: 0 },
  };

  it('现金分红：持仓跨过除权日，现金增加、成本下调', () => {
    // bar0 买入；bar2 除权（分红 2 元/股）
    const cs = seriesMs([100, 100, 98, 98, 98]);
    const exDate = cs[2].datetime as unknown as number; // datetime is number in this series
    const r = runBacktest(buyHold, cs, {
      initCash: 100_000,
      positionRatio: 0.5,
      corporateActions: [{ exDateMs: exDate, dividendPerShare: 2 }],
    });
    expect(r.corpEvents).toHaveLength(1);
    expect(r.corpEvents[0].note).toContain('分红');
    // 半仓约 400 股（费用挤压后整手）× 2 = 800 现金
    expect(r.corpEvents[0].cashDelta).toBeCloseTo(800, 5);
    expect(r.corpEvents[0].sharesDelta).toBe(0);
  });

  it('送股：股数按比例增加', () => {
    const cs = seriesMs([100, 100, 50, 50, 50]); // 10送10 后价格腰斩
    const exDate = cs[2].datetime as unknown as number;
    const r = runBacktest(buyHold, cs, {
      initCash: 100_000,
      positionRatio: 0.5,
      corporateActions: [{ exDateMs: exDate, perShareBonus: 1 }],
    });
    expect(r.corpEvents).toHaveLength(1);
    expect(r.corpEvents[0].sharesDelta).toBeCloseTo(400, 5); // 原约 400 股 1:1 送股
  });

  it('窗口前的除权不追溯', () => {
    const cs = seriesMs([100, 100, 100]);
    const beforeStart = start - 86400_000;
    const r = runBacktest(buyHold, cs, {
      initCash: 100_000,
      positionRatio: 0.5,
      corporateActions: [{ exDateMs: beforeStart, dividendPerShare: 99 }],
    });
    expect(r.corpEvents).toHaveLength(0);
  });

  it('未持仓时除权不产生事件记录（已推进游标）', () => {
    // 一直 hold，从不买入
    const hold: Strategy = {
      id: 'h',
      label: 'h',
      enabledByDefault: true,
      evaluate: () => ({ side: 'hold', reason: '', strength: 0 }),
    };
    const cs = seriesMs([100, 100, 100]);
    const r = runBacktest(hold, cs, {
      corporateActions: [{ exDateMs: cs[1].datetime as unknown as number, dividendPerShare: 1 }],
    });
    expect(r.corpEvents).toHaveLength(0);
    expect(r.trades).toHaveLength(0);
  });

  it('未传 corporateActions 时 corpEvents 为空（兼容旧结果）', () => {
    const cs = series([100, 105, 110, 95, 90]);
    const r = runBacktest(custom, cs);
    expect(r.corpEvents).toEqual([]);
  });
});
