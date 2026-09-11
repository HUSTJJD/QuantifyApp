/**
 * 远程选股纯筛选逻辑单测（不联网）。
 */
import { filterFundFlowRows } from '@/quant/remoteScreen';
import type { FundsFlowingItem } from '@/data/api';

const row = (
  code: string,
  mainNetInflow: number | null,
  changePct: number | null,
): FundsFlowingItem => ({
  symbol: { code, exchange: 'SH' },
  name: `股票${code}`,
  price: 10,
  changePct,
  mainNetInflow,
  mainNetInflowPct: null,
});

describe('remoteScreen.filterFundFlowRows', () => {
  const rows = [
    row('600001', 1e8, 5),
    row('600002', 2e8, -1),
    row('600003', 5e7, 3),
    row('600004', null, 2),
    row('600005', -1e7, 1),
  ];

  it('按主力净流入下限过滤并降序', () => {
    const hits = filterFundFlowRows(rows, { minMainNetInflow: 6e7 });
    expect(hits.map((h) => h.symbol.code)).toEqual(['600002', '600001']);
    expect(hits[0].mainNetInflow).toBe(2e8);
  });

  it('按涨跌幅过滤', () => {
    const hits = filterFundFlowRows(rows, { minChangePct: 3 });
    expect(hits.map((h) => h.symbol.code).sort()).toEqual(['600001', '600003']);
  });

  it('limit 截断', () => {
    const hits = filterFundFlowRows(rows, { limit: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0].symbol.code).toBe('600002');
  });

  it('无条件时返回全量按净流入排序', () => {
    const hits = filterFundFlowRows(rows, {});
    expect(hits[0].symbol.code).toBe('600002');
    expect(hits.map((h) => h.symbol.code)).toContain('600004');
  });
});
