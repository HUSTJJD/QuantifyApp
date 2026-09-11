import {
  buildCandidatePool,
  filterActionableSignals,
  planBatchFollow,
} from '@/quant/candidatePool';
import type { ScanHitRow } from '@/data/db/QuantStore';
import type { TradeSignal } from '@/quant/signals';
import type { Symbol } from '@/data/api';

function hitRow(code: string, exchange = 'SH', name = code): ScanHitRow {
  return {
    code,
    exchange,
    name,
    reasons: 'MACD 金叉',
    lastClose: 10,
    changePct: 1.5,
    metrics: '{}',
  };
}

function tradeSignal(
  code: string,
  exchange: Symbol['exchange'],
  side: TradeSignal['side'],
  strength: number,
): TradeSignal {
  return {
    symbol: { code, exchange },
    symbolKey: `${code}.${exchange}`,
    side,
    strength,
    reasons: ['测试'],
    contributions: [],
    ts: Date.now(),
  };
}

describe('buildCandidatePool', () => {
  it('去重并保留首次出现', () => {
    const pool = buildCandidatePool([hitRow('600000'), hitRow('600000'), hitRow('000001', 'SZ')]);
    expect(pool).toHaveLength(2);
    expect(pool[0].symbol.code).toBe('600000');
    expect(pool[1].symbol.exchange).toBe('SZ');
  });

  it('空输入返回空数组', () => {
    expect(buildCandidatePool([])).toEqual([]);
  });
});

describe('filterActionableSignals', () => {
  const pool = buildCandidatePool([hitRow('600000'), hitRow('000001', 'SZ')]);

  it('只保留候选池内的 buy/sell 信号', () => {
    const signals = [
      tradeSignal('600000', 'SH', 'buy', 2),
      tradeSignal('000001', 'SZ', 'sell', -1.5),
      tradeSignal('600000', 'SH', 'hold', 0),
      tradeSignal('999999', 'SH', 'buy', 3), // 不在候选池
    ];
    const out = filterActionableSignals(signals, pool);
    expect(out).toHaveLength(2);
    expect(out[0].symbol.code).toBe('600000');
    expect(out[0].side).toBe('buy');
    expect(out[1].side).toBe('sell');
  });

  it('按强度绝对值降序', () => {
    const signals = [
      tradeSignal('000001', 'SZ', 'buy', 1.2),
      tradeSignal('600000', 'SH', 'buy', 2.5),
    ];
    const out = filterActionableSignals(signals, pool);
    expect(out[0].strength).toBe(2.5);
  });

  it('低于 minStrength 的信号被过滤', () => {
    const signals = [tradeSignal('600000', 'SH', 'buy', 0.5)];
    expect(filterActionableSignals(signals, pool, 1)).toHaveLength(0);
  });

  it('价格取候选池 lastClose', () => {
    const signals = [tradeSignal('600000', 'SH', 'buy', 2)];
    const out = filterActionableSignals(signals, pool);
    expect(out[0].price).toBe(10);
  });
});

describe('planBatchFollow', () => {
  const account = {
    cash: 100_000,
    positions: [
      { symbol: { code: '000001', exchange: 'SZ' as const }, available: 500 },
    ],
  };

  it('买入按现金比例估算整手股数', () => {
    const signals = [
      { symbol: { code: '600000', exchange: 'SH' as const }, side: 'buy' as const, strength: 2, reasons: [], price: 10 },
    ];
    const plan = planBatchFollow(signals, account, 0.3);
    expect(plan.actionable).toBe(1);
    expect(plan.items[0].qty).toBeGreaterThan(0);
    expect(plan.items[0].qty % 100).toBe(0);
  });

  it('卖出按可用持仓比例估算', () => {
    const signals = [
      { symbol: { code: '000001', exchange: 'SZ' as const }, side: 'sell' as const, strength: -2, reasons: [], price: 10 },
    ];
    const plan = planBatchFollow(signals, account, 0.5);
    expect(plan.items[0].qty).toBe(200); // 500 * 0.5 = 250 → 整手 200
  });

  it('买入上限 maxBuys 生效', () => {
    const signals = Array.from({ length: 5 }, (_, i) => ({
      symbol: { code: `60000${i}`, exchange: 'SH' as const },
      side: 'buy' as const,
      strength: 3 - i,
      reasons: [],
      price: 10,
    }));
    const plan = planBatchFollow(signals, account, 0.2, 2);
    expect(plan.actionable).toBe(2);
    expect(plan.skipped).toBe(3);
    expect(plan.items[2].skipReason).toContain('上限');
  });

  it('资金不足时跳过', () => {
    const poor = { cash: 100, positions: [] };
    const signals = [
      { symbol: { code: '600000', exchange: 'SH' as const }, side: 'buy' as const, strength: 2, reasons: [], price: 1000 },
    ];
    const plan = planBatchFollow(signals, poor, 0.3);
    expect(plan.actionable).toBe(0);
    expect(plan.items[0].skipReason).toBe('可用资金不足');
  });

  it('无持仓时卖出跳过', () => {
    const signals = [
      { symbol: { code: '999999', exchange: 'SH' as const }, side: 'sell' as const, strength: -2, reasons: [], price: 10 },
    ];
    const plan = planBatchFollow(signals, account, 0.3);
    expect(plan.items[0].skipReason).toBe('可用持仓不足');
  });
});
