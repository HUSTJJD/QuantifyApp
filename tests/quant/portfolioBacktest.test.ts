import { runPortfolioBacktest } from '@/quant/portfolioBacktest';

/** 生成单调上涨的 equity，每日收益恒定（始终"持仓"） */
function risingEquity(start: number, dailyRet: number, n: number): number[] {
  const out = [start];
  for (let i = 1; i < n; i++) out.push(out[i - 1] * (1 + dailyRet));
  return out;
}

describe('runPortfolioBacktest', () => {
  it('无约束时同时持有全部，NAV 增长且长度正确', () => {
    const legs = [
      { key: 'A', equity: risingEquity(100, 0.01, 21) },
      { key: 'B', equity: risingEquity(100, 0.012, 21) },
    ];
    const r = runPortfolioBacktest(legs, { initCash: 1_000_000, maxPositions: 2 });
    expect(r.nav).toHaveLength(21); // 20 个交易日 + 起点
    expect(r.nav[r.nav.length - 1]).toBeGreaterThan(1_000_000);
    expect(r.avgPositions).toBeCloseTo(2, 5);
    expect(r.skippedDaysPct).toBe(0);
    expect(r.exposurePct).toBe(100);
  });

  it('maxPositions=1 时资金竞争：每日仅持 1 只，跳过其余', () => {
    const legs = [
      { key: 'A', equity: risingEquity(100, 0.01, 21) },
      { key: 'B', equity: risingEquity(100, 0.01, 21) },
    ];
    const r = runPortfolioBacktest(legs, { initCash: 1_000_000, maxPositions: 1 });
    expect(r.maxPositions).toBe(1);
    expect(r.skippedDaysPct).toBe(100); // 每天都想持 2 只但只能持 1
    expect(r.avgPositions).toBeCloseTo(1, 5);
    expect(r.nav[r.nav.length - 1]).toBeGreaterThan(1_000_000);
  });

  it('全平 equity 永不持仓，曝光为 0', () => {
    const legs = [
      { key: 'A', equity: [100, 100, 100, 100, 100] },
      { key: 'B', equity: [100, 100, 100, 100, 100] },
    ];
    const r = runPortfolioBacktest(legs, { initCash: 1_000_000, maxPositions: 2 });
    expect(r.exposurePct).toBe(0);
    expect(r.nav[r.nav.length - 1]).toBeCloseTo(1_000_000, 2);
  });

  it('结果可复现（同输入同输出）', () => {
    const legs = [{ key: 'A', equity: risingEquity(100, 0.02, 31) }];
    const a = runPortfolioBacktest(legs, { initCash: 500_000, maxPositions: 1 });
    const b = runPortfolioBacktest(legs, { initCash: 500_000, maxPositions: 1 });
    expect(a.nav).toEqual(b.nav);
    expect(a.metrics.totalReturnPct).toBeCloseTo(b.metrics.totalReturnPct, 10);
  });

  it('空腿或不足 2 日返回安全值', () => {
    const r = runPortfolioBacktest([], { initCash: 1000 });
    expect(r.nav).toEqual([1000]);
    expect(r.metrics.totalReturnPct).toBe(0);
  });
});
