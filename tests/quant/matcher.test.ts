import { matchLimitOrders } from '@/simulation/matcher';
import type { SimAccount, Order } from '@/simulation/types';
import type { Quote } from '@/data/api';

function makeQuote(code: string, exchange: 'SH', last: number): Quote {
  return {
    symbol: { code, exchange },
    last,
    prevClose: last,
    open: last,
    high: last,
    low: last,
    volume: 1000,
    amount: last * 1000,
  };
}

function makeOrder(side: 'buy' | 'sell', price: number, status: Order['status'] = 'pending'): Order {
  return {
    id: `ord_${Math.random()}`,
    symbol: { code: '600000', exchange: 'SH' },
    side,
    type: 'limit',
    price,
    quantity: 100,
    filledQty: 0,
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeAccount(overrides: Partial<SimAccount> = {}): SimAccount {
  return {
    initCash: 100_000,
    cash: 100_000,
    frozen: 0,
    positions: [],
    orders: [],
    trades: [],
    initialized: true,
    ...overrides,
  };
}

describe('matchLimitOrders', () => {
  it('买单限价 >= 现价 → 以现价成交', () => {
    const order = makeOrder('buy', 12);
    const acc = makeAccount({ orders: [order] });
    const quotes = new Map([['600000.SH', makeQuote('600000', 'SH', 11.5)]]);
    const r = matchLimitOrders(acc, quotes);
    expect(r.filledOrderIds).toHaveLength(1);
    expect(r.newTrades[0].price).toBe(11.5);
    expect(r.account.orders[0].status).toBe('filled');
  });

  it('买单限价 < 现价 → 不成交', () => {
    const order = makeOrder('buy', 10);
    const acc = makeAccount({ orders: [order] });
    const quotes = new Map([['600000.SH', makeQuote('600000', 'SH', 11)]]);
    const r = matchLimitOrders(acc, quotes);
    expect(r.filledOrderIds).toHaveLength(0);
    expect(r.account.orders[0].status).toBe('pending');
  });

  it('卖单限价 <= 现价 → 以现价成交', () => {
    const order = makeOrder('sell', 10);
    const acc = makeAccount({
      orders: [order],
      positions: [{ symbol: { code: '600000', exchange: 'SH' }, shares: 500, available: 500, costPrice: 10, todayBuy: 0 }],
    });
    const quotes = new Map([['600000.SH', makeQuote('600000', 'SH', 10.5)]]);
    const r = matchLimitOrders(acc, quotes);
    expect(r.filledOrderIds).toHaveLength(1);
    expect(r.newTrades[0].price).toBe(10.5);
  });

  it('卖单限价 > 现价 → 不成交', () => {
    const order = makeOrder('sell', 12);
    const acc = makeAccount({
      orders: [order],
      positions: [{ symbol: { code: '600000', exchange: 'SH' }, shares: 500, available: 500, costPrice: 10, todayBuy: 0 }],
    });
    const quotes = new Map([['600000.SH', makeQuote('600000', 'SH', 11)]]);
    const r = matchLimitOrders(acc, quotes);
    expect(r.filledOrderIds).toHaveLength(0);
  });

  it('非 pending 单不撮合', () => {
    const order = makeOrder('buy', 12, 'filled');
    const acc = makeAccount({ orders: [order] });
    const quotes = new Map([['600000.SH', makeQuote('600000', 'SH', 11)]]);
    const r = matchLimitOrders(acc, quotes);
    expect(r.filledOrderIds).toHaveLength(0);
  });

  it('无行情时不撮合', () => {
    const order = makeOrder('buy', 12);
    const acc = makeAccount({ orders: [order] });
    const r = matchLimitOrders(acc, new Map());
    expect(r.filledOrderIds).toHaveLength(0);
  });

  it('买单资金不足不成交', () => {
    const order = makeOrder('buy', 12);
    const acc = makeAccount({ orders: [order], cash: 100 }); // 不够买 100 股
    const quotes = new Map([['600000.SH', makeQuote('600000', 'SH', 11)]]);
    const r = matchLimitOrders(acc, quotes);
    expect(r.filledOrderIds).toHaveLength(0);
  });

  it('卖单持仓不足不成交', () => {
    const order = makeOrder('sell', 10);
    const acc = makeAccount({
      orders: [order],
      positions: [{ symbol: { code: '600000', exchange: 'SH' }, shares: 50, available: 50, costPrice: 10, todayBuy: 0 }],
    });
    const quotes = new Map([['600000.SH', makeQuote('600000', 'SH', 11)]]);
    const r = matchLimitOrders(acc, quotes);
    expect(r.filledOrderIds).toHaveLength(0);
  });

  it('多单同时撮合', () => {
    const o1 = makeOrder('buy', 12);
    const o2 = makeOrder('buy', 11);
    const acc = makeAccount({ orders: [o1, o2] });
    const quotes = new Map([['600000.SH', makeQuote('600000', 'SH', 11)]]);
    const r = matchLimitOrders(acc, quotes);
    expect(r.filledOrderIds).toHaveLength(2);
  });
});
