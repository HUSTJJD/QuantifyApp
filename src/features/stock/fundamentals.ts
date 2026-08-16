/**
 * 个股基本面格式化：把行情层返回的估值(Valuation)与财报(FinancialReport)
 * 转换为详情页可直接消费的、类型安全的展示结构。
 * 所有取值对缺失/异常做了兜底，避免 UI 因上游字段缺失而崩溃。
 */
import type { Valuation, FinancialReport, Symbol } from '@/api';

/** 安全取数：把 unknown 转成 number | null。 */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 格式化估值指标，缺失返回 null。 */
export interface ValuationView {
  symbol: Symbol;
  name?: string | null;
  peTtm: number | null;
  peMrq: number | null;
  pbMrq: number | null;
  psTtm: number | null;
  pcfTtm: number | null;
  timestamp?: number | null;
}

export function toValuationView(v: Valuation): ValuationView {
  return {
    symbol: v.symbol,
    name: v.name ?? null,
    peTtm: num(v.peTtm),
    peMrq: num(v.peMrq),
    pbMrq: num(v.pbMrq),
    psTtm: num(v.psTtm),
    pcfTtm: num(v.pcfTtm),
    timestamp: v.timestamp ?? null,
  };
}

/** 把多个估值按 symbol 的 code 建索引，便于按个股查表。 */
export function indexValuations(list: Valuation[]): Map<string, ValuationView> {
  const m = new Map<string, ValuationView>();
  for (const v of list) m.set(v.symbol.code, toValuationView(v));
  return m;
}

/** 财务关键指标（从松散 FinancialReport 安全提取）。 */
export interface FundamentalMetrics {
  /** 每股收益 */
  eps: number | null;
  /** 营业收入 */
  operatingIncome: number | null;
  /** 营业成本 */
  operatingCosts: number | null;
  /** 净利润 */
  netProfit: number | null;
  /** 归母净利润 */
  parentNetProfit: number | null;
  /** 总资产 */
  totalAssets: number | null;
  /** 净资产（股东权益） */
  equity: number | null;
  /** 经营现金流净额 */
  operatingCashFlow: number | null;
}

/** 从一份财报提取关键指标（report 已是强类型 FinancialReport）。 */
export function extractMetrics(report: FinancialReport): FundamentalMetrics {
  return {
    eps: num(report.basicEps),
    operatingIncome: num(report.operatingIncome),
    operatingCosts: num(report.operatingCosts),
    netProfit: num(report.netProfit),
    parentNetProfit: num(report.parentHolderNetProfit),
    totalAssets: num(report.totalAssets),
    equity: num(report.holderEquityTotal),
    operatingCashFlow: num(report.operatingCashFlow),
  };
}

/** 取最新一份财报（按 periodEndMs 降序，无时间则保持原序）。 */
export function latestReport(reports: FinancialReport[]): FundamentalMetrics | null {
  if (!reports || reports.length === 0) return null;
  const sorted = reports
    .slice()
    .sort((a, b) => (b.periodEndMs ?? 0) - (a.periodEndMs ?? 0));
  return extractMetrics(sorted[0]);
}

/** 数值格式化为展示字符串：null → '--'，否则按精度保留。 */
export function fmtMetric(v: number | null, opts: { digits?: number; scale?: number } = {}): string {
  if (v === null) return '--';
  const { digits = 2, scale = 1 } = opts;
  const scaled = v * scale;
  if (!Number.isFinite(scaled)) return '--';
  return scaled.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** 大数缩写：亿/万。例如 1.2e8 → '1.20亿'。 */
export function fmtLarge(v: number | null): string {
  if (v === null) return '--';
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return v.toFixed(2);
}

/** 比率格式化为百分比字符串：null → '--'，0.15 → '15.00%'。 */
export function fmtPct(v: number | null, digits = 2): string {
  if (v === null) return '--';
  if (!Number.isFinite(v)) return '--';
  return `${(v * 100).toFixed(digits)}%`;
}

/**
 * 派生估值/质量指标（纯函数，安全兜底）。
 * 输入为估值视图 + 财报指标 + 可选的盈利增速（用于 PEG）。
 */
export interface DerivedMetrics {
  /** 净资产收益率 ROE = 净利润 / 净资产（缺失返回 null） */
  roe: number | null;
  /** 毛利率 = (营收 − 营业成本) / 营收 */
  grossMargin: number | null;
  /** 净利率 = 净利润 / 营收 */
  netMargin: number | null;
  /** PEG = PE(TTM) / 盈利同比增速(%)，缺增速或无 PE 返回 null */
  peg: number | null;
}

/**
 * 计算派生指标。
 * @param valuation 估值视图（需 peTtm）
 * @param metrics 财报关键指标
 * @param opts.earningsGrowthPct 盈利同比增速（百分比数值，如 25 表示 +25%），用于 PEG
 */
export function computeDerivedMetrics(
  valuation: ValuationView | null,
  metrics: FundamentalMetrics | null,
  opts: { earningsGrowthPct?: number | null } = {},
): DerivedMetrics {
  const roe =
    metrics && metrics.netProfit !== null && metrics.equity && metrics.equity !== 0
      ? metrics.netProfit / metrics.equity
      : null;

  let grossMargin: number | null = null;
  if (metrics && metrics.operatingIncome && metrics.operatingIncome !== 0) {
    const cost = metrics.operatingCosts ?? 0;
    grossMargin = (metrics.operatingIncome - cost) / metrics.operatingIncome;
  }

  let netMargin: number | null = null;
  if (metrics && metrics.operatingIncome && metrics.operatingIncome !== 0 && metrics.netProfit !== null) {
    netMargin = metrics.netProfit / metrics.operatingIncome;
  }

  let peg: number | null = null;
  const g = opts.earningsGrowthPct ?? null;
  if (valuation && valuation.peTtm !== null && g !== null && g !== 0) {
    peg = valuation.peTtm / g;
  }

  return { roe, grossMargin, netMargin, peg };
}

// 由已有财报（按报告期排列的年度数据）估算「盈利同比增速(%)」，用于 PEG。
// 取最近两期（按 periodEndMs 降序）的净利润（netProfit）做同比：
//   growth% = (最新 - 上一期) / |上一期| * 100
// 当样本不足（<2 期）、任一期净利润缺失或上一期净利润非正时返回 null（无法可靠计算）。
export function computeEarningsGrowthPct(reports: FinancialReport[]): number | null {
  const sorted = [...reports]
    .filter((r) => r && typeof r.netProfit === 'number' && typeof r.periodEndMs === 'number')
    .sort((a, b) => (b.periodEndMs as number) - (a.periodEndMs as number));
  if (sorted.length < 2) return null;
  const latest = sorted[0].netProfit as number;
  const prev = sorted[1].netProfit as number;
  if (prev <= 0 || !Number.isFinite(prev)) return null; // 同比基数非正，增速无意义
  return ((latest - prev) / Math.abs(prev)) * 100;
}
