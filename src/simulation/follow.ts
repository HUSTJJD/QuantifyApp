/**
 * 信号一键跟单：把量化买卖信号直接映射到模拟盘下单。
 * 买入用「可用资金 × 仓位比例」估算可买整手股数；卖出用「可用持仓 × 仓位比例」。
 * 使用市价单（以参考现价成交）。纯异步服务，UI 层调用后拿到成交结果。
 */
import type { Symbol } from '@/api';
import type { SignalSide } from '@/quant/strategies';
import { storage } from '@/storage';
import { SimAccountRepo } from './SimAccount';
import { roundShare, type SubmitResult } from './engine';
import type { Order } from './types';

const FOLLOWED_KEY = 'sim_followed_v1';

/** 读取已跟单记录（跨会话防重复） */
export async function loadFollowed(): Promise<Set<string>> {
  const arr = await storage.getObject<string[]>(FOLLOWED_KEY);
  return new Set(arr ?? []);
}

/** 记录已跟单（按 symbolKey_side 去重） */
export async function markFollowed(key: string): Promise<void> {
  const set = await loadFollowed();
  set.add(key);
  await storage.setObject(FOLLOWED_KEY, Array.from(set));
}

export interface FollowOptions {
  symbol: Symbol;
  side: Exclude<SignalSide, 'hold'>;
  /** 参考现价：用于市价成交与数量估算 */
  price: number;
  /** 跟单仓位比例 0~1；默认 0.3（买入=可用资金占比，卖出=可用持仓占比） */
  ratio?: number;
}

function rejection(symbol: Symbol, side: Exclude<SignalSide, 'hold'>, price: number, message: string): SubmitResult {
  const order: Order = {
    id: 'rejected',
    symbol,
    side,
    type: 'market',
    price,
    quantity: 0,
    filledQty: 0,
    status: 'rejected',
    message,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return { ok: false, order, message };
}

export interface FollowResult extends SubmitResult {
  /** 实际跟单股数（成交/尝试） */
  qty: number;
}

/** 估算跟单股数（供 UI 预览，不计费用精确值） */
export function estimateFollowQty(
  account: { cash: number; positions: { symbol: Symbol; available: number }[] },
  symbol: Symbol,
  side: Exclude<SignalSide, 'hold'>,
  price: number,
  ratio: number,
): number {
  if (price <= 0) return 0;
  if (side === 'buy') {
    const perShare = price * 1.00025 + 5 + price * 0.0001;
    const budget = account.cash * ratio;
    return roundShare(Math.floor(budget / perShare));
  }
  const pos = account.positions.find((p) => p.symbol.code === symbol.code && p.symbol.exchange === symbol.exchange);
  const avail = pos?.available ?? 0;
  return roundShare(Math.floor(avail * ratio));
}

export async function followSignal(opts: FollowOptions): Promise<FollowResult> {
  const ratio = opts.ratio ?? 0.3;
  const acc = await SimAccountRepo.get();
  const qty = estimateFollowQty(acc, opts.symbol, opts.side, opts.price, ratio);
  if (qty <= 0) {
    const msg = opts.side === 'buy' ? '可用资金不足，无法跟单' : '可用持仓不足，无法跟单';
    return { ...rejection(opts.symbol, opts.side, opts.price, msg), qty: 0 };
  }
  const { result } = await SimAccountRepo.submit({
    symbol: opts.symbol,
    side: opts.side,
    price: opts.price,
    quantity: qty,
    type: 'market',
    refPrice: opts.price,
  });
  return { ...result, qty };
}
