import {
  computeMainFlow,
  computeTierFlow,
  classifyTier,
  summarizeNorthbound,
  fmtFlow,
  DEFAULT_TIERS,
  FlowTick,
} from '@/features/stock/capitalFlow';

describe('capitalFlow 资金流向', () => {
  it('computeMainFlow：买单总额 − 卖单总额 = 净流入', () => {
    const ticks: FlowTick[] = [
      { volume: 1000, amount: 10000, side: 'buy' },
      { volume: 500, amount: 5000, side: 'buy' },
      { volume: 800, amount: 4000, side: 'sell' },
    ];
    const r = computeMainFlow(ticks);
    expect(r.buyAmount).toBe(15000);
    expect(r.sellAmount).toBe(4000);
    expect(r.netInflow).toBe(11000);
  });

  it('computeMainFlow：空输入返回 0', () => {
    const r = computeMainFlow([]);
    expect(r).toEqual({ netInflow: 0, buyAmount: 0, sellAmount: 0 });
  });

  it('classifyTier：按阈值分层', () => {
    expect(classifyTier(DEFAULT_TIERS.xlarge, DEFAULT_TIERS)).toBe('xlarge');
    expect(classifyTier(DEFAULT_TIERS.large, DEFAULT_TIERS)).toBe('large');
    expect(classifyTier(DEFAULT_TIERS.medium, DEFAULT_TIERS)).toBe('medium');
    expect(classifyTier(1, DEFAULT_TIERS)).toBe('small');
  });

  it('computeTierFlow：超大单与大单净流入独立累计', () => {
    const ticks: FlowTick[] = [
      { volume: DEFAULT_TIERS.xlarge, amount: 900000, side: 'buy' },
      { volume: DEFAULT_TIERS.xlarge, amount: 300000, side: 'sell' },
      { volume: DEFAULT_TIERS.large, amount: 200000, side: 'buy' },
      { volume: 10, amount: 1000, side: 'sell' },
    ];
    const r = computeTierFlow(ticks);
    expect(r.xlarge.netInflow).toBe(600000);
    expect(r.large.netInflow).toBe(200000);
    expect(r.small.netInflow).toBe(-1000);
    expect(r.medium.netInflow).toBe(0);
  });

  it('summarizeNorthbound：沪深合计', () => {
    const n = summarizeNorthbound({ shNetBuy: 120000000, szNetBuy: -30000000 });
    expect(n.shNetBuy).toBe(120000000);
    expect(n.szNetBuy).toBe(-30000000);
    expect(n.totalNetBuy).toBe(90000000);
  });

  it('summarizeNorthbound：缺失值按 0 处理', () => {
    const n = summarizeNorthbound({ shNetBuy: null });
    expect(n.totalNetBuy).toBe(0);
  });

  it('fmtFlow：亿/万/个位 格式化并带符号', () => {
    expect(fmtFlow(123456789)).toBe('+1.23亿');
    expect(fmtFlow(-45000)).toBe('-4.50万');
    expect(fmtFlow(0)).toBe('0');
    expect(fmtFlow(320)).toBe('+320');
  });
});
