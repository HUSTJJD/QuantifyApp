/**
 * 模拟盘资产计算：基于持仓 + 当前行情快照，实时计算市值、盈亏。
 */
import type { Quote, Symbol } from '@/api';
import type { SimAccount, SimPosition, PortfolioSummary } from './types';
import { round2 } from './engine';

/** 行情快照：symbolKey -> 现价 */
export type QuoteMap = Map<string, number>;

export function symbolKey(symbol: Symbol): string {
  return `${symbol.code}.${symbol.exchange}`;
}

function quoteOf(map: QuoteMap | Quote[], symbol: Symbol): number | null {
  if (Array.isArray(map)) {
    const q = map.find((x) => x.symbol.code === symbol.code && x.symbol.exchange === symbol.exchange);
    return q ? q.last : null;
  }
  const v = map.get(symbolKey(symbol));
  return v ?? null;
}

/** 单个持仓盈亏（基于现价） */
export function positionPnl(pos: SimPosition, price: number | null): {
  marketValue: number;
  pnl: number;
  pnlPct: number;
} {
  const marketValue = price ? round2(price * pos.shares) : 0;
  const cost = round2(pos.costPrice * pos.shares);
  const pnl = round2(marketValue - cost);
  const pnlPct = cost > 0 ? round2((pnl / cost) * 100) : 0;
  return { marketValue, pnl, pnlPct };
}

/** 汇总账户资产 */
export function summarize(
  account: SimAccount,
  quotes: QuoteMap | Quote[],
): PortfolioSummary {
  let marketValue = 0;
  let dayPnl = 0;
  for (const pos of account.positions) {
    const price = quoteOf(quotes, pos.symbol);
    if (price == null) continue;
    const mv = round2(price * pos.shares);
    marketValue = round2(marketValue + mv);
    const cost = round2(pos.costPrice * pos.shares);
    dayPnl = round2(dayPnl + (mv - cost));
  }
  const cash = round2(account.cash);
  const totalAsset = round2(cash + marketValue);
  const totalPnl = round2(totalAsset - account.initCash);
  const totalPnlPct = account.initCash > 0 ? round2((totalPnl / account.initCash) * 100) : 0;
  const dayBase = round2(marketValue - dayPnl);
  const dayPnlPct = dayBase > 0 ? round2((dayPnl / dayBase) * 100) : 0;
  return { cash, marketValue, totalAsset, totalPnl, totalPnlPct, dayPnl, dayPnlPct };
}
