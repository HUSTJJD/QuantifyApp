/**
 * 模拟盘撮合引擎。
 * 标准 A 股模拟盘规则：
 *  - 买入：需冻结资金 = 成交额 + 费用；成交后扣减现金、增加持仓（成本含费用）。
 *  - 卖出：T+1，今日买入不可卖；成交后增加现金 = 成交额 - 费用；减少持仓。
 *  - 手续费：佣金（万2.5，最低5元）+ 印花税（卖出千0.5）+ 过户费（万0.1）。
 *  - 数量：A 股 100 股/手整数倍；科创板 200 股起，这里统一按 100 取整。
 *  - 市价单：使用下单时传入的参考现价成交（模拟盘无盘口，等价快照）。
 */
import type { Symbol } from '@/api';
import type { Order, SimPosition, SimAccount, Side, OrderType, Trade } from './types';

/** 佣金费率（万分之） */
export const COMMISSION_RATE = 0.00025;
/** 佣金最低（元） */
export const COMMISSION_MIN = 5;
/** 印花税（仅卖出，千分之） */
export const STAMP_RATE = 0.0005;
/** 过户费（万分之，双向） */
export const TRANSFER_RATE = 0.0001;
/** 每手股数 */
export const LOT_SIZE = 100;
/** 默认初始资金 */
export const DEFAULT_INIT_CASH = 100_000;

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

/** 计算单笔交易费用 */
export function calcFee(side: Side, amount: number): number {
  const commission = Math.max(amount * COMMISSION_RATE, COMMISSION_MIN);
  const stamp = side === 'sell' ? amount * STAMP_RATE : 0;
  const transfer = amount * TRANSFER_RATE;
  return round2(commission + stamp + transfer);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function roundShare(n: number): number {
  return Math.floor(n / LOT_SIZE) * LOT_SIZE;
}

export interface SubmitInput {
  symbol: Symbol;
  side: Side;
  /** 委托价（限价）；市价单传当前快照价 */
  price: number;
  /** 委托数量（股）；会自动向下取整到整手 */
  quantity: number;
  type?: OrderType;
  /** 当前行情快照价（市价单成交用此价，可不传则退用 price） */
  refPrice?: number;
}

export interface SubmitResult {
  ok: boolean;
  order: Order;
  trade?: Trade;
  message?: string;
}

/**
 * 在给定账户上提交一笔委托并即时撮合，返回新账户与成交结果。
 * 纯函数：不修改入参，返回新的 SimAccount。
 */
export function submitOrder(account: SimAccount, input: SubmitInput): { account: SimAccount; result: SubmitResult } {
  const type = input.type ?? 'limit';
  const fillPrice = type === 'market' && input.refPrice ? input.refPrice : input.price;

  const orderBase: Order = {
    id: nextId('ord'),
    symbol: input.symbol,
    side: input.side,
    type,
    price: round2(input.price),
    quantity: input.quantity,
    filledQty: 0,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // 校验数量：A 股须为整手（100 股）整数倍，且 > 0
  if (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity % LOT_SIZE !== 0) {
    const rejected: Order = { ...orderBase, status: 'rejected', message: '数量须为整手（100股）整数倍', updatedAt: Date.now() };
    return { account, result: { ok: false, order: rejected, message: rejected.message } };
  }
  const qty = input.quantity;

  const amount = round2(fillPrice * qty);

  if (input.side === 'buy') {
    const fee = calcFee('buy', amount);
    const need = round2(amount + fee);
    if (need > round2(account.cash + account.frozen)) {
      const rejected: Order = { ...orderBase, status: 'rejected', message: '可用资金不足', updatedAt: Date.now() };
      return { account, result: { ok: false, order: rejected, message: rejected.message } };
    }
    // 成交
    const trade: Trade = {
      id: nextId('trd'),
      orderId: orderBase.id,
      symbol: input.symbol,
      side: 'buy',
      price: round2(fillPrice),
      quantity: qty,
      amount,
      fee,
      cashDelta: -need,
      ts: Date.now(),
    };
    const positions = applyBuy(account.positions, input.symbol, qty, fillPrice, fee);
    const newOrder: Order = { ...orderBase, filledQty: qty, status: 'filled', updatedAt: Date.now() };
    const next: SimAccount = {
      ...account,
      cash: round2(account.cash - need),
      positions,
      orders: [newOrder, ...account.orders],
      trades: [trade, ...account.trades],
    };
    return { account: next, result: { ok: true, order: newOrder, trade } };
  }

  // 卖出：校验可用持仓（T+1）
  const pos = account.positions.find((p) => p.symbol.code === input.symbol.code && p.symbol.exchange === input.symbol.exchange);
  const avail = pos?.available ?? 0;
  if (!pos || avail < qty) {
    const rejected: Order = { ...orderBase, status: 'rejected', message: '可用持仓不足（T+1，今日买入不可卖）', updatedAt: Date.now() };
    return { account, result: { ok: false, order: rejected, message: rejected.message } };
  }
  const fee = calcFee('sell', amount);
  const proceeds = round2(amount - fee);
  const trade: Trade = {
    id: nextId('trd'),
    orderId: orderBase.id,
    symbol: input.symbol,
    side: 'sell',
    price: round2(fillPrice),
    quantity: qty,
    amount,
    fee,
    cashDelta: proceeds,
    ts: Date.now(),
  };
  const positions = applySell(account.positions, input.symbol, qty);
  const newOrder: Order = { ...orderBase, filledQty: qty, status: 'filled', updatedAt: Date.now() };
  const next: SimAccount = {
    ...account,
    cash: round2(account.cash + proceeds),
    positions,
    orders: [newOrder, ...account.orders],
    trades: [trade, ...account.trades],
  };
  return { account: next, result: { ok: true, order: newOrder, trade } };
}

function applyBuy(
  positions: SimPosition[],
  symbol: Symbol,
  qty: number,
  price: number,
  fee: number,
): SimPosition[] {
  const cost = price * qty + fee;
  const idx = positions.findIndex((p) => p.symbol.code === symbol.code && p.symbol.exchange === symbol.exchange);
  if (idx < 0) {
    return [
      ...positions,
      { symbol, shares: qty, available: 0, costPrice: round2(cost / qty), todayBuy: qty },
    ];
  }
  const old = positions[idx];
  const newShares = old.shares + qty;
  const newCostPrice = round2((old.costPrice * old.shares + cost) / newShares);
  const next = { ...old, shares: newShares, costPrice: newCostPrice, todayBuy: old.todayBuy + qty, available: old.available };
  return [...positions.slice(0, idx), next, ...positions.slice(idx + 1)];
}

function applySell(positions: SimPosition[], symbol: Symbol, qty: number): SimPosition[] {
  const idx = positions.findIndex((p) => p.symbol.code === symbol.code && p.symbol.exchange === symbol.exchange);
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

/** 隔夜处理：把今日买入解锁为可用（T+1），并把 todayBuy 清零 */
export function settleOvernight(positions: SimPosition[]): SimPosition[] {
  return positions.map((p) => ({
    ...p,
    available: p.shares,
    todayBuy: 0,
  }));
}
