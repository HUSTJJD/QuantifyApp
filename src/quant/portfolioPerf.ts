/**
 * 组合绩效：持仓盈亏分解、净值指标、简单归因。
 *
 * 纯函数，不依赖 UI / 网络 / 存储：
 *  - `computePositionPnl`：单持仓盈亏（市值/成本/盈亏/占比）
 *  - `computePortfolioSummary`：组合汇总（总市值/总成本/总盈亏/仓位）
 *  - `computeNavMetrics`：净值序列指标（收益/年化/最大回撤/夏普/波动率）
 *  - `computeAttribution`：各持仓对总盈亏的贡献排序
 */
import type { Symbol } from '@/data/api';

export interface PositionInput {
  symbol: Symbol;
  shares: number;
  costPrice: number;
}

export interface PositionPnl {
  symbol: Symbol;
  shares: number;
  costPrice: number;
  lastPrice: number;
  /** 市值 */
  value: number;
  /** 成本金额 */
  cost: number;
  /** 盈亏金额 */
  pnl: number;
  /** 盈亏百分比 */
  pnlPct: number;
  /** 占组合市值比例（0~1） */
  weight: number;
}

/** 计算单持仓盈亏 */
export function computePositionPnl(
  pos: PositionInput,
  lastPrice: number,
  totalValue: number,
): PositionPnl {
  const value = lastPrice * pos.shares;
  const cost = pos.costPrice * pos.shares;
  const pnl = value - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  const weight = totalValue > 0 ? value / totalValue : 0;
  return {
    symbol: pos.symbol,
    shares: pos.shares,
    costPrice: pos.costPrice,
    lastPrice,
    value,
    cost,
    pnl,
    pnlPct,
    weight,
  };
}

export interface PortfolioSummary {
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPct: number;
  /** 持仓数量 */
  positionCount: number;
  /** 最大单持仓占比（0~1） */
  maxWeight: number;
}

/** 组合汇总 */
export function computePortfolioSummary(positions: PositionPnl[]): PortfolioSummary {
  let totalValue = 0;
  let totalCost = 0;
  for (const p of positions) {
    totalValue += p.value;
    totalCost += p.cost;
  }
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const maxWeight = positions.length > 0 ? Math.max(...positions.map((p) => p.weight)) : 0;
  return {
    totalValue,
    totalCost,
    totalPnl,
    totalPnlPct,
    positionCount: positions.length,
    maxWeight,
  };
}

export interface NavMetrics {
  /** 区间总收益（%） */
  totalReturnPct: number;
  /** 年化收益（%），按 252 交易日 */
  annualizedReturnPct: number;
  /** 最大回撤（%） */
  maxDrawdownPct: number;
  /** 夏普比率（年化，rf=0） */
  sharpe: number;
  /** 年化波动率（%） */
  volatilityPct: number;
}

/**
 * 净值序列指标。
 * @param nav 升序净值序列（至少 2 个点）
 */
export function computeNavMetrics(nav: number[]): NavMetrics {
  const empty: NavMetrics = { totalReturnPct: 0, annualizedReturnPct: 0, maxDrawdownPct: 0, sharpe: 0, volatilityPct: 0 };
  if (nav.length < 2 || nav[0] <= 0) return empty;

  const totalReturnPct = ((nav[nav.length - 1] - nav[0]) / nav[0]) * 100;
  const bars = nav.length;
  const annualizedReturnPct = (Math.pow(nav[nav.length - 1] / nav[0], 252 / (bars - 1)) - 1) * 100;

  // 最大回撤
  let peak = -Infinity;
  let maxDd = 0;
  for (const v of nav) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }

  // 日收益
  const rets: number[] = [];
  for (let i = 1; i < nav.length; i++) {
    if (nav[i - 1] > 0) rets.push((nav[i] - nav[i - 1]) / nav[i - 1]);
  }
  const mean = rets.length > 0 ? rets.reduce((s, r) => s + r, 0) / rets.length : 0;
  const variance = rets.length > 1 ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length : 0;
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  const volatilityPct = std * Math.sqrt(252) * 100;

  return {
    totalReturnPct,
    annualizedReturnPct,
    maxDrawdownPct: maxDd * 100,
    sharpe,
    volatilityPct,
  };
}

export interface AttributionItem {
  symbol: Symbol;
  name: string;
  pnl: number;
  /** 对总盈亏的贡献占比（0~1）；总盈亏为 0 时为 0 */
  contributionPct: number;
}

/**
 * 归因：各持仓对总盈亏的贡献，按盈亏绝对值降序。
 * @param positions 持仓盈亏列表
 */
export function computeAttribution(positions: PositionPnl[]): AttributionItem[] {
  const totalPnl = positions.reduce((s, p) => s + p.pnl, 0);
  return positions
    .map((p) => ({
      symbol: p.symbol,
      name: p.symbol.name || p.symbol.code,
      pnl: p.pnl,
      contributionPct: totalPnl !== 0 ? p.pnl / Math.abs(totalPnl) : 0,
    }))
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
}
