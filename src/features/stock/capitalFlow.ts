/**
 * 资金流向计算（纯函数，便于单测与 UI 复用）。
 *
 * 输入为「逐笔/分钟级」成交切片（tick），不依赖任何网络/存储，
 * 由上层把行情源返回的数据归一化成 FlowTick 后传入。
 * 计算：
 *  - 主力净流入：Σ(买单成交额) − Σ(卖单成交额)
 *  - 大单分层：按成交量阈值把 tick 分到 超大单/大单/中单/小单，各自净流入
 *  - 北向资金：沪深股通净买入合计（由上游直接给出净买入额）
 *
 * 所有「净流向」正负语义：>0 净流入（资金看好），<0 净流出。
 */

export type FlowSide = 'buy' | 'sell';

/** 单笔资金流切片。amount 单位：元；volume 单位：股。 */
export interface FlowTick {
  volume: number;
  amount: number;
  side: FlowSide;
}

/** 分层阈值（按单笔成交量，单位：股）。 */
export interface TierThresholds {
  /** 大于等于该值 → 超大单 */
  xlarge: number;
  /** 大于等于该值 → 大单 */
  large: number;
  /** 大于等于该值 → 中单；否则小单 */
  medium: number;
}

export const DEFAULT_TIERS: TierThresholds = { xlarge: 500000, large: 100000, medium: 20000 };

export type Tier = 'xlarge' | 'large' | 'medium' | 'small';

export interface FlowResult {
  /** 净流入（元），买 − 卖 */
  netInflow: number;
  /** 买入成交额（元） */
  buyAmount: number;
  /** 卖出成交额（元） */
  sellAmount: number;
}

const EMPTY: FlowResult = { netInflow: 0, buyAmount: 0, sellAmount: 0 };

/** 汇总一组 tick 的净流入。 */
export function computeMainFlow(ticks: FlowTick[]): FlowResult {
  if (!ticks || ticks.length === 0) return { ...EMPTY };
  let buy = 0;
  let sell = 0;
  for (const t of ticks) {
    const amt = Number.isFinite(t.amount) ? t.amount : 0;
    if (t.side === 'buy') buy += amt;
    else if (t.side === 'sell') sell += amt;
  }
  return { netInflow: buy - sell, buyAmount: buy, sellAmount: sell };
}

/** 按成交量把单笔归入对应层级。 */
export function classifyTier(volume: number, t: TierThresholds = DEFAULT_TIERS): Tier {
  if (volume >= t.xlarge) return 'xlarge';
  if (volume >= t.large) return 'large';
  if (volume >= t.medium) return 'medium';
  return 'small';
}

const TIER_ORDER: Tier[] = ['xlarge', 'large', 'medium', 'small'];

export type TierFlow = Record<Tier, FlowResult>;

/** 分层的资金流（超大单/大单/中单/小单各自净流入）。 */
export function computeTierFlow(ticks: FlowTick[], t: TierThresholds = DEFAULT_TIERS): TierFlow {
  const acc: TierFlow = {
    xlarge: { ...EMPTY },
    large: { ...EMPTY },
    medium: { ...EMPTY },
    small: { ...EMPTY },
  };
  if (!ticks) return acc;
  for (const tick of ticks) {
    const tier = classifyTier(tick.volume, t);
    const slot = acc[tier];
    if (tick.side === 'buy') slot.buyAmount += tick.amount;
    else if (tick.side === 'sell') slot.sellAmount += tick.amount;
    slot.netInflow = slot.buyAmount - slot.sellAmount;
  }
  return acc;
}

export interface NorthboundFlow {
  /** 沪股通净买入（元），正为净流入 */
  shNetBuy: number;
  /** 深股通净买入（元） */
  szNetBuy: number;
  /** 合计净买入（元） */
  totalNetBuy: number;
}

/** 汇总北向（沪深股通）净买入。 */
export function summarizeNorthbound(input: { shNetBuy?: number | null; szNetBuy?: number | null }): NorthboundFlow {
  const sh = numOr0(input.shNetBuy);
  const sz = numOr0(input.szNetBuy);
  return { shNetBuy: sh, szNetBuy: sz, totalNetBuy: sh + sz };
}

function numOr0(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** 把净流向格式化为「+1.23亿 / -0.45万 / 0」。 */
export function fmtFlow(v: number): string {
  const sign = v > 0 ? '+' : '';
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${sign}${(v / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}${(v / 1e4).toFixed(2)}万`;
  return `${sign}${v.toFixed(0)}`;
}

export const TIER_LABEL: Record<Tier, string> = {
  xlarge: '超大单',
  large: '大单',
  medium: '中单',
  small: '小单',
};

export function tierOrder(): Tier[] {
  return TIER_ORDER;
}
