import {
  backtestConfigKey,
  backtestOptsKey,
  getCachedBacktest,
  putCachedBacktest,
  clearBacktestCache,
} from '@/quant/backtestCache';
import type { BacktestResult } from '@/quant/backtest';

function fakeResult(equity: number[]): BacktestResult {
  return {
    trades: [],
    equity,
    initCash: 100_000,
    finalEquity: equity[equity.length - 1] ?? 100_000,
    totalReturnPct: 0,
    annualizedReturnPct: 0,
    maxDrawdownPct: 0,
    longestDrawdownBars: 0,
    trailingDrawdownBars: 0,
    sharpe: 0,
    sortino: 0,
    calmar: 0,
    volatilityPct: 0,
    winRate: 0,
    profitFactor: 0,
    exposurePct: 0,
    avgHoldingBars: 0,
    bestTradePct: 0,
    worstTradePct: 0,
    totalFees: 0,
    corpEvents: [],
  } as unknown as BacktestResult;
}

describe('backtestCache key', () => {
  it('拼接格式稳定', () => {
    expect(backtestConfigKey({ dataKey: 'd1', optsKey: 'o1' })).toBe('bt:d1#o1');
  });

  it('相同配置生成相同 optsKey', () => {
    expect(backtestOptsKey({ initCash: 100_000 })).toBe(backtestOptsKey({ initCash: 100_000 }));
  });

  it('不同初始资金生成不同 optsKey', () => {
    expect(backtestOptsKey({ initCash: 100_000 })).not.toBe(backtestOptsKey({ initCash: 200_000 }));
  });
});

describe('backtestCache read/write', () => {
  beforeEach(async () => {
    await clearBacktestCache();
  });

  it('未命中返回 null', async () => {
    expect(await getCachedBacktest('bt:missing#x')).toBeNull();
  });

  it('写入后可命中且内容一致', async () => {
    const key = backtestConfigKey({ dataKey: 'symA.day', optsKey: backtestOptsKey({}) });
    const result = fakeResult([100_000, 101_000, 102_000]);
    await putCachedBacktest(key, result);
    const got = await getCachedBacktest(key);
    expect(got).not.toBeNull();
    expect(got!.equity).toEqual([100_000, 101_000, 102_000]);
    expect(got!.initCash).toBe(100_000);
  });

  it('不同键互不干扰', async () => {
    const k1 = backtestConfigKey({ dataKey: 'a', optsKey: 'o' });
    const k2 = backtestConfigKey({ dataKey: 'b', optsKey: 'o' });
    await putCachedBacktest(k1, fakeResult([1, 2]));
    expect(await getCachedBacktest(k2)).toBeNull();
    expect((await getCachedBacktest(k1))!.equity).toEqual([1, 2]);
  });
});
