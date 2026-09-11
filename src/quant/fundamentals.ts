/**
 * 基本面选股（对照 InStock README「股票基本面选股」）。
 *
 * 规则：
 *  1. 市盈率 ≤ 20 且 > 0
 *  2. 市净率 ≤ 10
 *  3. 净资产收益率 ≥ 15（%）
 *
 * 数据来自 marketData.getValuations / getFinancialIndicators；
 * 本模块是纯函数，便于扫描器与策略选股复用。
 */
import type { FinancialIndicator, Valuation } from '@/data/api';

export interface FundamentalRules {
  peMax: number;
  peMin: number;
  pbMax: number;
  roeMin: number;
}

export const DEFAULT_FUNDAMENTAL_RULES: FundamentalRules = {
  peMax: 20,
  peMin: 0,
  pbMax: 10,
  roeMin: 15,
};

export interface FundamentalCheckInput {
  valuation?: Valuation | null;
  /** 财务指标列表（含 ROE 等）；不同源 indexId 命名不一，做模糊匹配 */
  indicators?: FinancialIndicator[] | null;
}

/** 从财务指标中尽力解析 ROE（%）。常见 indexId / category 含 roe、净资产收益率。 */
export function extractRoe(indicators?: FinancialIndicator[] | null): number | null {
  if (!indicators?.length) return null;
  for (const it of indicators) {
    if (it.category !== 'profitability' && !/roe|净资产收益/i.test(it.indexId)) continue;
    const n = Number(it.value);
    if (Number.isFinite(n)) {
      // 源可能返回 0.15 或 15
      return Math.abs(n) <= 1 ? n * 100 : n;
    }
  }
  // 兜底：扫 indexId 关键字
  for (const it of indicators) {
    if (!/roe|净资产收益/i.test(it.indexId ?? '')) continue;
    const n = Number(it.value);
    if (Number.isFinite(n)) return Math.abs(n) <= 1 ? n * 100 : n;
  }
  return null;
}

export function checkFundamental(
  input: FundamentalCheckInput,
  rules: Partial<FundamentalRules> = {},
): { pass: boolean; reasons: string[]; pe: number | null; pb: number | null; roe: number | null } {
  const r = { ...DEFAULT_FUNDAMENTAL_RULES, ...rules };
  const pe = input.valuation?.peTtm ?? input.valuation?.peMrq ?? null;
  const pb = input.valuation?.pbMrq ?? null;
  const roe = extractRoe(input.indicators);
  const reasons: string[] = [];
  let pass = true;

  if (pe == null || !Number.isFinite(pe) || pe <= r.peMin || pe > r.peMax) {
    pass = false;
    reasons.push(pe == null ? '缺 PE' : `PE ${pe.toFixed(1)} 不在 (${r.peMin}, ${r.peMax}]`);
  }
  if (pb == null || !Number.isFinite(pb) || pb > r.pbMax) {
    pass = false;
    reasons.push(pb == null ? '缺 PB' : `PB ${pb.toFixed(1)} > ${r.pbMax}`);
  }
  if (roe == null || !Number.isFinite(roe) || roe < r.roeMin) {
    pass = false;
    reasons.push(roe == null ? '缺 ROE' : `ROE ${roe.toFixed(1)}% < ${r.roeMin}%`);
  }
  if (pass) {
    reasons.push(`PE ${pe!.toFixed(1)} / PB ${pb!.toFixed(1)} / ROE ${roe!.toFixed(1)}%`);
  }
  return { pass, reasons, pe, pb, roe };
}
