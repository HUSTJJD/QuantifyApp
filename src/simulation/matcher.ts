/**
 * 限价单撮合：对 pending 限价委托，用最新行情判断是否可成交。
 *
 * 规则（A 股简化）：
 *  - 买单：限价 >= 现价 → 以现价成交（价格优先于限价）
 *  - 卖单：限价 <= 现价 → 以现价成交
 *  - 市价单不走此路径（提交时已即时成交）
 *
 * 纯函数，不修改入参。
 */
import type { Quote } from '@/data/api';
import type { SimAccount, Order, Trade, SimPosition } from './types';
import { calcFee, round2, roundShare, LOT_SIZE } from './engine';

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

export interface MatchResult {
  account: SimAccount;
  /** 本次撮合成交的订单 id */
  filledOrderIds: string[];
  /** 本次产生的成交 */
  newTrades: Trade[];
}

/**
 * 用最新行情尝试撮合全部 pending 限价单。
 * @param account 当前账户
 * @param quotes 行情快照（symbolKey → Quote）
 */
export function matchLimitOrders(
  account: SimAccount,
  quotes: Map<string, Quote>,
): MatchResult {
  const pending = account.orders.filter((o) => o.status === 'pending' && o.type === 'limit');
  if (pending.length === 0) {
    return { account, filledOrderIds: [], newTrades: [] };
  }

  let cash = account.cash;
  let positions = [...account.positions];
  const trades: Trade[] = [];
  const filledIds: string[] = [];
  const orderUpdates = new Map<string, Order>();

  for (const order of pending) {
    const key = `${order.symbol.code}.${order.symbol.exchange}`;
    const quote = quotes.get(key);
    if (!quote || quote.last <= 0) continue;

    const canFill =
      order.side === 'buy' ? order.price >= quote.last : order.price <= quote.last;
    if (!canFill) continue;

    const fillPrice = quote.last;
    const qty = roundShare(order.quantity);
    if (qty <= 0) continue;

    const amount = round2(fillPrice * qty);
    const fee = calcFee(order.side, amount);

    if (order.side === 'buy') {
      const need = round2(amount + fee);
      if (need > cash) continue; // 资金不足，保持 pending
      cash = round2(cash - need);
      positions = applyBuy(positions, order.symbol, qty, fillPrice, fee);
      const trade: Trade = {
        id: nextId('trd'),
        orderId: order.id,
        symbol: order.symbol,
        side: 'buy',
        price: round2(fillPrice),
        quantity: qty,
        amount,
        fee,
        cashDelta: -need,
        ts: Date.now(),
      };
      trades.push(trade);
    } else {
      const pos = positions.find(
        (p) => p.symbol.code === order.symbol.code && p.symbol.exchange === order.symbol.exchange,
      );
      const avail = pos?.available ?? 0;
      if (avail < qty) continue; // 持仓不足，保持 pending
      const proceeds = round2(amount - fee);
      cash = round2(cash + proceeds);
      positions = applySell(positions, order.symbol, qty);
      const trade: Trade = {
        id: nextId('trd'),
        orderId: order.id,
        symbol: order.symbol,
        side: 'sell',
        price: round2(fillPrice),
        quantity: qty,
        amount,
        fee,
        cashDelta: proceeds,
        ts: Date.now(),
      };
      trades.push(trade);
    }

    filledIds.push(order.id);
    orderUpdates.set(order.id, {
      ...order,
      filledQty: qty,
      status: 'filled' as const,
      updatedAt: Date.now(),
    });
  }

  if (filledIds.length === 0) {
    return { account, filledOrderIds: [], newTrades: [] };
  }

  const orders = account.orders.map((o) => orderUpdates.get(o.id) ?? o);
  const next: SimAccount = {
    ...account,
    cash,
    positions,
    orders,
    trades: [...trades, ...account.trades],
  };
  return { account: next, filledOrderIds: filledIds, newTrades: trades };
}

function applyBuy(
  positions: SimPosition[],
  symbol: SimPosition['symbol'],
  qty: number,
  price: number,
  fee: number,
): SimPosition[] {
  const cost = price * qty + fee;
  const idx = positions.findIndex(
    (p) => p.symbol.code === symbol.code && p.symbol.exchange === symbol.exchange,
  );
  if (idx < 0) {
    return [...positions, { symbol, shares: qty, available: 0, costPrice: round2(cost / qty), todayBuy: qty }];
  }
  const old = positions[idx];
  const newShares = old.shares + qty;
  const newCostPrice = round2((old.costPrice * old.shares + cost) / newShares);
  const next = { ...old, shares: newShares, costPrice: newCostPrice, todayBuy: old.todayBuy + qty, available: old.available };
  return [...positions.slice(0, idx), next, ...positions.slice(idx + 1)];
}

function applySell(
  positions: SimPosition[],
  symbol: SimPosition['symbol'],
  qty: number,
): SimPosition[] {
  const idx = positions.findIndex(
    (p) => p.symbol.code === symbol.code && p.symbol.exchange === symbol.exchange,
  );
  if (idx < 0) return positions;
  const old = positions[idx];
  const newShares = old.shares - qty;
  const newTodayBuy = Math.max(0, old.todayBuy - qty);
  const newAvailable = old.available - qty;
  if (newShares <= 0) {
    return [...positions.slice(0, idx), ...positions.slice(idx + 1)];
  }
  const next = { ...old, shares: newShares, available: newAvailable, todayBuy: newTodayBuy };
  return [...positions.slice(0, idx), next, ...positions.slice(idx + 1)];
}
