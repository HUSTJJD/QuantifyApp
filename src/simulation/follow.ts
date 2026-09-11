/**
 * 信号一键跟单：把量化买卖信号直接映射到模拟盘下单。
 * 买入用「可用资金 × 仓位比例」估算可买整手股数；卖出用「可用持仓 × 仓位比例」。
 * 使用市价单（以参考现价成交）。纯异步服务，UI 层调用后拿到成交结果。
 * 跟单成功可选拉起同花顺详情页（openThsAfterFollow，默认 true）。
 */
import type { Symbol } from '@/data/api';
import type { SignalSide } from '@/quant/strategies';
import { quantStore } from '@/data/db/QuantStore';
import { openThsDetail } from '@/utils/thsDeepLink';
import { SimAccountRepo } from './SimAccount';
import { roundShare, type SubmitResult } from './engine';
import type { Order } from './types';

export const FOLLOWED_KEY = 'sim_followed_v1';

/** 读取已跟单记录（跨会话防重复） */
export async function loadFollowed(): Promise<Set<string>> {
  const rows = await quantStore().listFollowed();
  return new Set(rows.map((r) => r.dedupeKey));
}

/** 记录已跟单（按 dedupe_key 去重，落 followed_signal 表） */
export async function markFollowed(key: string): Promise<void> {
  const [symbolKey, side] = key.split('_');
  await quantStore().markFollowed({
    dedupeKey: key,
    symbolKey: symbolKey ?? key,
    side: side ?? '',
    createdAt: Date.now(),
  });
}

export interface FollowOptions {
  symbol: Symbol;
  side: Exclude<SignalSide, 'hold'>;
  /** 参考现价：用于市价成交与数量估算 */
  price: number;
  /** 跟单仓位比例 0~1；默认 0.3（买入=可用资金占比，卖出=可用持仓占比） */
  ratio?: number;
  /**
   * 去重键：传此键时先做"已跟单"检查，已存在则跳过（防同信号重复下单）。
   * 不传则每次都下单（不防重）。默认用 `${symbolKey}_${side}`。
   */
  dedupeKey?: string;
  /** 跟单成功后自动拉起同花顺详情页；默认 true。未安装同花顺时静默失败。 */
  openThsAfterFollow?: boolean;
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
  /** 是否成功拉起同花顺（openThsAfterFollow 且下单成功时才有意义） */
  thsOpened?: boolean;
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
  // 去重：避免同一信号被重复跟单（跨会话/重复推送）
  const key = opts.dedupeKey ?? `${opts.symbol.code}.${opts.symbol.exchange}_${opts.side}`;
  const followed = await loadFollowed();
  if (followed.has(key)) {
    return { ...rejection(opts.symbol, opts.side, opts.price, '该信号已跟单，跳过'), qty: 0, ok: false };
  }
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
  // 下单成功才落去重标记（失败不入册，允许下次重试）
  if (result.ok) {
    await markFollowed(key);
    // 一键跟单 → 自动跳转同花顺详情（失败不影响跟单结果）
    if (opts.openThsAfterFollow !== false) {
      const thsOpened = await openThsDetail(opts.symbol);
      return { ...result, qty, thsOpened };
    }
  }
  return { ...result, qty };
}
