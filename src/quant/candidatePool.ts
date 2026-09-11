/**
 * 候选池：扫描命中标的 → 订阅信号引擎 → 批量跟单。
 *
 * 纯函数核心，不依赖 UI / 网络 / 定时器：
 *  - `buildCandidatePool`：从 scan_hit 行构造候选池（去重、排序）
 *  - `filterActionableSignals`：从信号列表中筛出候选池内可操作的买卖信号
 *  - `planBatchFollow`：按仓位上限规划批量跟单计划（每标的独立估算股数）
 *
 * UI 层负责拉数据、调 followSignal、渲染结果。
 */
import type { Symbol } from '@/data/api';
import type { SignalSide } from '@/quant/strategies';
import type { TradeSignal } from '@/quant/signals';
import type { ScanHitRow } from '@/data/db/QuantStore';

export interface CandidateItem {
  symbol: Symbol;
  name: string;
  reasons: string;
  lastClose: number;
  changePct: number | null;
}

/** 从 scan_hit 行构造候选池（按 code.exchange 去重，保留首次） */
export function buildCandidatePool(rows: ScanHitRow[]): CandidateItem[] {
  const seen = new Set<string>();
  const out: CandidateItem[] = [];
  for (const r of rows) {
    const key = `${r.code}.${r.exchange}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      symbol: { code: r.code, exchange: r.exchange as Symbol['exchange'], name: r.name },
      name: r.name,
      reasons: r.reasons,
      lastClose: r.lastClose,
      changePct: r.changePct,
    });
  }
  return out;
}

export interface ActionableSignal {
  symbol: Symbol;
  side: Exclude<SignalSide, 'hold'>;
  strength: number;
  reasons: string[];
  price: number;
}

/**
 * 从信号列表中筛出候选池内、side 为 buy/sell 的可操作信号。
 * @param signals 信号引擎产出
 * @param pool 候选池
 * @param minStrength 最低强度绝对值（默认 1，与信号引擎阈值一致）
 */
export function filterActionableSignals(
  signals: TradeSignal[],
  pool: CandidateItem[],
  minStrength = 1,
): ActionableSignal[] {
  const poolKeys = new Set(pool.map((c) => `${c.symbol.code}.${c.symbol.exchange}`));
  const priceByKey = new Map(pool.map((c) => [`${c.symbol.code}.${c.symbol.exchange}`, c.lastClose]));
  const out: ActionableSignal[] = [];
  for (const sig of signals) {
    if (sig.side === 'hold') continue;
    if (Math.abs(sig.strength) < minStrength) continue;
    if (!poolKeys.has(sig.symbolKey)) continue;
    const price = priceByKey.get(sig.symbolKey) ?? 0;
    if (price <= 0) continue;
    out.push({
      symbol: sig.symbol,
      side: sig.side,
      strength: sig.strength,
      reasons: sig.reasons,
      price,
    });
  }
  // 按强度降序（强信号优先跟单）
  out.sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength));
  return out;
}

export interface BatchFollowPlanItem {
  symbol: Symbol;
  side: Exclude<SignalSide, 'hold'>;
  price: number;
  /** 预估股数（0 表示资金/持仓不足，跳过） */
  qty: number;
  /** 跳过原因（qty=0 时有值） */
  skipReason?: string;
}

export interface BatchFollowPlan {
  items: BatchFollowPlanItem[];
  /** 实际可跟单数量 */
  actionable: number;
  /** 跳过数量 */
  skipped: number;
}

/**
 * 规划批量跟单：对每条可操作信号独立估算股数。
 * 买入用「当前现金 × ratio」，卖出用「当前可用持仓 × ratio」。
 * 估算时扣减已规划的买入金额，避免同一轮多笔买入超额。
 *
 * @param signals 可操作信号（已按强度降序）
 * @param account 账户快照
 * @param ratio 单笔仓位比例（默认 0.3）
 * @param maxBuys 本轮最多买入笔数（默认 3，控制分散度）
 */
export function planBatchFollow(
  signals: ActionableSignal[],
  account: { cash: number; positions: { symbol: Symbol; available: number }[] },
  ratio = 0.3,
  maxBuys = 3,
): BatchFollowPlan {
  let remainingCash = account.cash;
  let buyCount = 0;
  const items: BatchFollowPlanItem[] = [];

  for (const sig of signals) {
    if (sig.side === 'buy') {
      if (buyCount >= maxBuys) {
        items.push({ symbol: sig.symbol, side: sig.side, price: sig.price, qty: 0, skipReason: `本轮买入已达上限 ${maxBuys}` });
        continue;
      }
      const budget = remainingCash * ratio;
      const perShare = sig.price * 1.00025 + 5 + sig.price * 0.0001;
      const qty = Math.floor(budget / perShare / 100) * 100;
      if (qty <= 0) {
        items.push({ symbol: sig.symbol, side: sig.side, price: sig.price, qty: 0, skipReason: '可用资金不足' });
        continue;
      }
      remainingCash -= qty * sig.price * 1.001; // 粗估含费用
      buyCount++;
      items.push({ symbol: sig.symbol, side: sig.side, price: sig.price, qty });
    } else {
      const pos = account.positions.find(
        (p) => p.symbol.code === sig.symbol.code && p.symbol.exchange === sig.symbol.exchange,
      );
      const avail = pos?.available ?? 0;
      const qty = Math.floor(avail * ratio / 100) * 100;
      if (qty <= 0) {
        items.push({ symbol: sig.symbol, side: sig.side, price: sig.price, qty: 0, skipReason: '可用持仓不足' });
        continue;
      }
      items.push({ symbol: sig.symbol, side: sig.side, price: sig.price, qty });
    }
  }

  const actionable = items.filter((i) => i.qty > 0).length;
  return { items, actionable, skipped: items.length - actionable };
}
