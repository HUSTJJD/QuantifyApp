import {
  computePositionPnl,
  computePortfolioSummary,
  computeNavMetrics,
  computeAttribution,
} from '@/quant/portfolioPerf';
import type { Symbol } from '@/data/api';

const S1: Symbol = { code: '600000', exchange: 'SH', name: '股票A' };
const S2: Symbol = { code: '000001', exchange: 'SZ', name: '股票B' };

describe('computePositionPnl', () => {
  it('计算市值/成本/盈亏/占比', () => {
    const pnl = computePositionPnl({ symbol: S1, shares: 1000, costPrice: 10 }, 12, 22000);
    expect(pnl.value).toBe(12000);
    expect(pnl.cost).toBe(10000);
    expect(pnl.pnl).toBe(2000);
    expect(pnl.pnlPct).toBeCloseTo(20);
    expect(pnl.weight).toBeCloseTo(12000 / 22000);
  });

  it('亏损时 pnlPct 为负', () => {
    const pnl = computePositionPnl({ symbol: S1, shares: 100, costPrice: 20 }, 15, 1500);
    expect(pnl.pnl).toBe(-500);
    expect(pnl.pnlPct).toBeCloseTo(-25);
  });

  it('成本为 0 时 pnlPct 为 0', () => {
    const pnl = computePositionPnl({ symbol: S1, shares: 100, costPrice: 0 }, 10, 1000);
    expect(pnl.pnlPct).toBe(0);
  });
});

describe('computePortfolioSummary', () => {
  it('汇总多持仓', () => {
    const p1 = computePositionPnl({ symbol: S1, shares: 1000, costPrice: 10 }, 12, 30000);
    const p2 = computePositionPnl({ symbol: S2, shares: 1000, costPrice: 10 }, 8, 30000);
    const s = computePortfolioSummary([p1, p2]);
    expect(s.totalValue).toBe(20000);
    expect(s.totalCost).toBe(20000);
    expect(s.totalPnl).toBe(0);
    expect(s.totalPnlPct).toBe(0);
    expect(s.positionCount).toBe(2);
  });

  it('空组合返回 0', () => {
    const s = computePortfolioSummary([]);
    expect(s.totalValue).toBe(0);
    expect(s.positionCount).toBe(0);
    expect(s.maxWeight).toBe(0);
  });
});

describe('computeNavMetrics', () => {
  it('单调上涨序列：正收益、零回撤', () => {
    const m = computeNavMetrics([100, 110, 120, 130]);
    expect(m.totalReturnPct).toBeCloseTo(30);
    expect(m.maxDrawdownPct).toBe(0);
    expect(m.annualizedReturnPct).toBeGreaterThan(0);
  });

  it('先涨后跌：回撤正确', () => {
    const m = computeNavMetrics([100, 120, 90]);
    expect(m.totalReturnPct).toBeCloseTo(-10);
    expect(m.maxDrawdownPct).toBeCloseTo(25); // 120→90 = 25%
  });

  it('少于 2 个点返回全 0', () => {
    expect(computeNavMetrics([100]).totalReturnPct).toBe(0);
    expect(computeNavMetrics([]).sharpe).toBe(0);
  });

  it('首值为 0 返回全 0', () => {
    expect(computeNavMetrics([0, 100]).totalReturnPct).toBe(0);
  });

  it('波动率非负', () => {
    const m = computeNavMetrics([100, 105, 98, 110, 102]);
    expect(m.volatilityPct).toBeGreaterThanOrEqual(0);
  });
});

describe('computeAttribution', () => {
  it('按盈亏绝对值降序，贡献占比正确', () => {
    const p1 = computePositionPnl({ symbol: S1, shares: 1000, costPrice: 10 }, 13, 21000); // +3000
    const p2 = computePositionPnl({ symbol: S2, shares: 1000, costPrice: 10 }, 9, 21000); // -1000
    const attr = computeAttribution([p1, p2]);
    expect(attr[0].symbol.code).toBe('600000');
    expect(attr[0].pnl).toBe(3000);
    // 总盈亏 = 2000，贡献 = pnl / |total|
    expect(attr[0].contributionPct).toBeCloseTo(3000 / 2000);
    expect(attr[1].contributionPct).toBeCloseTo(-1000 / 2000);
  });

  it('总盈亏为 0 时贡献为 0', () => {
    const p1 = computePositionPnl({ symbol: S1, shares: 100, costPrice: 10 }, 11, 2100); // +100
    const p2 = computePositionPnl({ symbol: S2, shares: 100, costPrice: 10 }, 9, 2100); // -100
    const attr = computeAttribution([p1, p2]);
    expect(attr[0].contributionPct).toBe(0);
  });
});
