/**
 * 模拟盘单测：撮合引擎（买入/卖出/费用/T+1/数量校验）+ 资产计算。
 * 纯函数 + 内存存储，可在 CI 跑。
 */
import { submitOrder, calcFee, roundShare, settleOvernight, reconcile, DEFAULT_INIT_CASH } from '@/simulation/engine';
import { summarize, positionPnl } from '@/simulation/calc';
import type { SimAccount } from '@/simulation';
import type { Symbol } from '@/api';

const SYM: Symbol = { code: '600519', exchange: 'SH', name: '贵州茅台' };

function freshAccount(): SimAccount {
  return { initCash: DEFAULT_INIT_CASH, cash: DEFAULT_INIT_CASH, frozen: 0, positions: [], orders: [], trades: [], initialized: true };
}

describe('engine', () => {
  it('买入成功并扣减现金、增加持仓', () => {
    const acc = freshAccount();
    const { account, result } = submitOrder(acc, { symbol: SYM, side: 'buy', price: 100, quantity: 100 });
    expect(result.ok).toBe(true);
    expect(account.cash).toBeCloseTo(DEFAULT_INIT_CASH - 100 * 100 - calcFee('buy', 100 * 100));
    expect(account.positions[0].shares).toBe(100);
    expect(account.positions[0].available).toBe(0); // T+1 今日买入不可卖
    expect(account.positions[0].todayBuy).toBe(100);
  });

  it('资金不足被拒绝', () => {
    const acc = freshAccount();
    const { result } = submitOrder(acc, { symbol: SYM, side: 'buy', price: 1000, quantity: 1000 });
    expect(result.ok).toBe(false);
    expect(result.order.status).toBe('rejected');
    expect(result.message).toContain('资金不足');
  });

  it('数量非整手被拒绝', () => {
    const acc = freshAccount();
    const { result } = submitOrder(acc, { symbol: SYM, side: 'buy', price: 100, quantity: 150 });
    expect(result.ok).toBe(false);
    expect(result.order.status).toBe('rejected');
  });

  it('T+1：今日买入不可卖', () => {
    let acc = freshAccount();
    acc = submitOrder(acc, { symbol: SYM, side: 'buy', price: 100, quantity: 100 }).account;
    const { result } = submitOrder(acc, { symbol: SYM, side: 'sell', price: 110, quantity: 100 });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('T+1');
  });

  it('隔夜解锁后可卖出并增加现金', () => {
    let acc = freshAccount();
    acc = submitOrder(acc, { symbol: SYM, side: 'buy', price: 100, quantity: 100 }).account;
    acc = { ...acc, positions: settleOvernight(acc.positions) };
    const before = acc.cash;
    const { account, result } = submitOrder(acc, { symbol: SYM, side: 'sell', price: 110, quantity: 100 });
    expect(result.ok).toBe(true);
    const expectCash = before + 110 * 100 - calcFee('sell', 110 * 100);
    expect(account.cash).toBeCloseTo(expectCash);
    expect(account.positions.length).toBe(0);
  });

  it('可用持仓不足被拒绝', () => {
    const acc = freshAccount();
    const { result } = submitOrder(acc, { symbol: SYM, side: 'sell', price: 110, quantity: 100 });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('可用持仓不足');
  });

  it('roundShare 向下取整到整手', () => {
    expect(roundShare(150)).toBe(100);
    expect(roundShare(50)).toBe(0);
  });

  it('多次买入成本摊薄：成本价介于两次买入价之间', () => {
    let acc = freshAccount();
    acc = submitOrder(acc, { symbol: SYM, side: 'buy', price: 100, quantity: 100 }).account;
    acc = submitOrder(acc, { symbol: SYM, side: 'buy', price: 200, quantity: 100 }).account;
    const pos = acc.positions[0];
    expect(pos.shares).toBe(200);
    // 成本 = (100*100+fee1 + 200*100+fee2) / 200，介于 100~200 之间且 > 150
    expect(pos.costPrice).toBeGreaterThan(150);
    expect(pos.costPrice).toBeLessThan(200);
    expect(pos.todayBuy).toBe(200);
  });

  it('卖出部分持仓后剩余股数与可用正确', () => {
    let acc = freshAccount();
    acc = submitOrder(acc, { symbol: SYM, side: 'buy', price: 100, quantity: 200 }).account;
    acc = { ...acc, positions: settleOvernight(acc.positions) };
    acc = submitOrder(acc, { symbol: SYM, side: 'sell', price: 110, quantity: 100 }).account;
    const pos = acc.positions[0];
    expect(pos.shares).toBe(100);
    expect(pos.available).toBe(100);
    expect(pos.todayBuy).toBe(0);
  });
});

describe('calc', () => {
  it('summarize 计算市值与盈亏', () => {
    let acc = freshAccount();
    acc = submitOrder(acc, { symbol: SYM, side: 'buy', price: 100, quantity: 100 }).account;
    acc = { ...acc, positions: settleOvernight(acc.positions) };
    const summary = summarize(acc, [{ symbol: SYM, last: 120, prevClose: 100 } as any]);
    expect(summary.marketValue).toBeCloseTo(120 * 100);
    expect(summary.totalAsset).toBeCloseTo(summary.cash + 120 * 100);
    expect(summary.totalPnl).toBeGreaterThan(0);
  });

  it('positionPnl 基于现价计算市值与盈亏', () => {
    const pos = { symbol: SYM, shares: 100, available: 100, costPrice: 100, todayBuy: 0 };
    const up = positionPnl(pos, 120);
    expect(up.marketValue).toBeCloseTo(120 * 100);
    expect(up.pnl).toBeGreaterThan(0);
    expect(up.pnlPct).toBeCloseTo(20);
    const down = positionPnl(pos, 90);
    expect(down.pnl).toBeLessThan(0);
  });
});

describe('reconcile', () => {
  it('正常账户三方勾稽一致（cash+持仓成本+费用≈initCash）', () => {
    let acc = freshAccount();
    acc = submitOrder(acc, { symbol: SYM, side: 'buy', price: 100, quantity: 100 }).account;
    const rep = reconcile(acc);
    expect(rep.consistent).toBe(true);
    expect(rep.tradeOrderConsistent).toBe(true);
    expect(Math.abs(rep.drift)).toBeLessThanOrEqual(0.01);
    expect(rep.totalFee).toBeGreaterThan(0);
  });

  it('买卖闭环后对账仍一致', () => {
    let acc = freshAccount();
    acc = submitOrder(acc, { symbol: SYM, side: 'buy', price: 100, quantity: 100 }).account;
    acc = { ...acc, positions: settleOvernight(acc.positions) };
    acc = submitOrder(acc, { symbol: SYM, side: 'sell', price: 110, quantity: 100 }).account;
    const rep = reconcile(acc);
    expect(rep.consistent).toBe(true);
    expect(rep.issues).toHaveLength(0);
  });
});
