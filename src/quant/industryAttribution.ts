/**
 * 行业归因纯函数：持仓 + 行业映射 → 行业贡献列表。
 */
import type { PositionPnl } from './portfolioPerf';

export interface IndustryAttributionItem {
  industry: string;
  pnl: number;
  weight: number;
  contributionPct: number;
  symbols: string[];
}

export function computeIndustryAttribution(
  positions: PositionPnl[],
  industryOf: (code: string, exchange: string) => string,
): IndustryAttributionItem[] {
  const totalPnl = positions.reduce((s, p) => s + p.pnl, 0);
  const totalValue = positions.reduce((s, p) => s + p.value, 0);
  const by = new Map<string, IndustryAttributionItem>();
  for (const p of positions) {
    const ind = industryOf(p.symbol.code, p.symbol.exchange) || '未分类';
    const key = `${p.symbol.code}.${p.symbol.exchange}`;
    const cur = by.get(ind) ?? {
      industry: ind,
      pnl: 0,
      weight: 0,
      contributionPct: 0,
      symbols: [],
    };
    cur.pnl += p.pnl;
    cur.weight += p.value;
    cur.symbols.push(key);
    by.set(ind, cur);
  }
  return [...by.values()]
    .map((it) => ({
      ...it,
      weight: totalValue > 0 ? it.weight / totalValue : 0,
      contributionPct: totalPnl !== 0 ? it.pnl / Math.abs(totalPnl) : 0,
    }))
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
}
