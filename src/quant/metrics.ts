/**
 * 绩效指标纯函数库（回测 / 组合 / 基准对比共用）。
 *
 * 之所以从 backtest.ts 抽出来：
 *  - 过去只有回测引擎能用这些算法，组合层面（多标的合成）与基准对比层（Alpha/Beta）
 *    要重新算一遍，复制实现容易漂移；
 *  - 全部为纯函数、无副作用，便于单测。
 *
 * 口径约定：
 *  - 方差/标准差按**总体**（除以 n，不是 n-1），与历史实现保持一致，保证结果可复现；
 *  - 年化因子 `barsPerYear` 由周期决定（日=252、周=52、月=12、分钟=见 `barsPerYearOfPeriod`），
 *    调用方必须传对，否则分钟 K 会被当成日 K 年化；
 *  - 无风险利率 `riskFreeAnnualPct` 为**年化百分数**（如 2 表示 2%），默认 0。
 */

/** 日 K 默认年化交易日数 */
export const DEFAULT_BARS_PER_YEAR = 252;

/**
 * 按 K 线周期给出年化 bar 数。
 * - 日/周/月为常规口径；
 * - 分钟级按 A 股每日 4 小时交易时长折算（60m=4 根/日，1m=240 根/日）。
 */
export function barsPerYearOfPeriod(period?: string): number {
  switch (period) {
    case 'week':
      return 52;
    case 'month':
      return 12;
    case '60m':
      return 4 * DEFAULT_BARS_PER_YEAR;
    case '30m':
      return 8 * DEFAULT_BARS_PER_YEAR;
    case '15m':
      return 16 * DEFAULT_BARS_PER_YEAR;
    case '5m':
      return 48 * DEFAULT_BARS_PER_YEAR;
    case '1m':
      return 240 * DEFAULT_BARS_PER_YEAR;
    default:
      return DEFAULT_BARS_PER_YEAR;
  }
}

/** 权益序列 → 简单收益率序列（长度 n-1） */
export function toReturns(equity: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1];
    if (prev > 0) out.push((equity[i] - prev) / prev);
  }
  return out;
}

/** 每根 bar 的无风险收益率（小数） */
function riskFreePerBar(barsPerYear: number, riskFreeAnnualPct: number): number {
  if (!(barsPerYear > 0)) return 0;
  return riskFreeAnnualPct / 100 / barsPerYear;
}

export interface DrawdownDetail {
  /** 最大回撤（%，正值） */
  maxDdPct: number;
  /** 最长回撤持续 bar 数（从峰值到恢复，未恢复则计到末尾） */
  longestDdBars: number;
  /** 期末仍处于回撤中的 bar 数（0 表示创新高中） */
  trailingDdBars: number;
}

/**
 * 最大回撤 + 回撤持续期。
 * 只用「创新高」重置计数器，避免把小幅反弹误判为回撤结束。
 */
export function maxDrawdownDetail(equity: number[]): DrawdownDetail {
  let peak = -Infinity;
  let peakIdx = 0;
  let maxDd = 0;
  let longest = 0;
  for (let i = 0; i < equity.length; i++) {
    const v = equity[i];
    if (v > peak) {
      peak = v;
      peakIdx = i;
    } else if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > maxDd) maxDd = dd;
      const len = i - peakIdx;
      if (len > longest) longest = len;
    }
  }
  const trailing = equity.length > 0 ? Math.max(0, equity.length - 1 - peakIdx) : 0;
  return { maxDdPct: maxDd * 100, longestDdBars: longest, trailingDdBars: trailing };
}

/** 最大回撤（%，正值） */
export function maxDrawdownPct(equity: number[]): number {
  return maxDrawdownDetail(equity).maxDdPct;
}

/** 区间总收益（%） */
export function totalReturnPct(equity: number[]): number {
  if (equity.length < 2) return 0;
  const first = equity[0];
  if (!(first > 0)) return 0;
  return ((equity[equity.length - 1] - first) / first) * 100;
}

/** 年化收益率（%，按几何复利） */
export function annualizedReturnPct(equity: number[], barsPerYear = DEFAULT_BARS_PER_YEAR): number {
  if (equity.length < 2 || barsPerYear <= 0) return 0;
  const first = equity[0];
  const last = equity[equity.length - 1];
  if (!(first > 0) || last <= 0) return 0;
  const periods = equity.length - 1;
  return (Math.pow(last / first, barsPerYear / periods) - 1) * 100;
}

/** 年化波动率（%，按 bar 收益标准差） */
export function annualizedVolatilityPct(equity: number[], barsPerYear = DEFAULT_BARS_PER_YEAR): number {
  const rets = toReturns(equity);
  if (rets.length === 0) return 0;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(barsPerYear) * 100;
}

/** 夏普比率（超额收益 / 全样本标准差） */
export function sharpeRatio(
  equity: number[],
  barsPerYear = DEFAULT_BARS_PER_YEAR,
  riskFreeAnnualPct = 0,
): number {
  const rets = toReturns(equity);
  if (rets.length === 0) return 0;
  const rf = riskFreePerBar(barsPerYear, riskFreeAnnualPct);
  const excess = rets.map((r) => r - rf);
  const mean = excess.reduce((s, r) => s + r, 0) / excess.length;
  const variance = excess.reduce((s, r) => s + (r - mean) ** 2, 0) / excess.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(barsPerYear);
}

/**
 * 索提诺比率（超额收益 / 下行标准差）。
 * 下行标准差只统计低于无风险利率的收益，比夏普更能反映「亏损方向的波动」。
 */
export function sortinoRatio(
  equity: number[],
  barsPerYear = DEFAULT_BARS_PER_YEAR,
  riskFreeAnnualPct = 0,
): number {
  const rets = toReturns(equity);
  if (rets.length === 0) return 0;
  const rf = riskFreePerBar(barsPerYear, riskFreeAnnualPct);
  const meanExcess = rets.reduce((s, r) => s + (r - rf), 0) / rets.length;
  let downSum = 0;
  let downCount = 0;
  for (const r of rets) {
    const d = r - rf;
    if (d < 0) {
      downSum += d * d;
      downCount++;
    }
  }
  if (downCount === 0) return meanExcess > 0 ? Infinity : 0;
  const downStd = Math.sqrt(downSum / downCount);
  if (downStd === 0) return 0;
  return (meanExcess / downStd) * Math.sqrt(barsPerYear);
}

/** 卡玛比率（年化收益 / 最大回撤）：单位回撤换来的年化收益 */
export function calmarRatio(annualizedPct: number, maxDdPct: number): number {
  if (!(maxDdPct > 0)) return annualizedPct > 0 ? Infinity : 0;
  return annualizedPct / maxDdPct;
}
