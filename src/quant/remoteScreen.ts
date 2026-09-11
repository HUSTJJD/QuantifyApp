/**
 * 远程选股桥：用统一行情契约取数，再用 stock-sdk 纯函数 screen 做条件筛选。
 *
 * 为什么不把 stock-sdk 的 `screen`/`backtest` 做成 DataSourceMethod：
 *  - 二者是**客户端纯函数**（过滤数组 / 回放 K 线），不发起网络请求，
 *    不应占用 SourceRouter 的「数据源能力」槽位；
 *  - 本项目的本地扫描（quant/scanner.scanMarket）与回测（quant/backtest.runBacktest）
 *    已覆盖实盘可用路径；这里补的是「远程快筛」——不依赖本地 K 线库，
 *    用资金流榜 / 今日异动等接口现拉现筛。
 *
 * 数据路径全部走 MarketDataClient 统一契约（多源兜底），上层不感知 fuyao/stock-sdk。
 */
import { screen } from 'stock-sdk';
import { marketData } from '@/data/api';
import type { FundsFlowingItem, FundFlowPeriod, StockChangeType, Symbol } from '@/data/api';

export interface RemoteScreenCriteria {
  /** 主力净流入下限（元，>=）；负值表示要求净流出 */
  minMainNetInflow?: number;
  /** 涨跌幅下限（%，>=） */
  minChangePct?: number;
  /** 最多返回条数，默认 20 */
  limit?: number;
}

export interface RemoteScreenHit {
  symbol: Symbol;
  name: string;
  changePct: number | null;
  mainNetInflow: number | null;
  price: number | null;
}

/**
 * 纯筛选：对资金流排行结果应用条件（stock-sdk screen 链式 API）。
 * 与网络无关，便于单测。
 */
export function filterFundFlowRows(
  rows: readonly FundsFlowingItem[],
  criteria: RemoteScreenCriteria,
): RemoteScreenHit[] {
  const limit = criteria.limit ?? 20;
  let builder = screen(rows);
  if (criteria.minMainNetInflow != null) {
    const minFlow = criteria.minMainNetInflow;
    builder = builder.where((r) => (r.mainNetInflow ?? -Infinity) >= minFlow);
  }
  if (criteria.minChangePct != null) {
    const minPct = criteria.minChangePct;
    builder = builder.where((r) => (r.changePct ?? -Infinity) >= minPct);
  }
  return builder
    .sortBy((r) => r.mainNetInflow ?? 0, 'desc')
    .top(limit)
    .map((r) => ({
      symbol: r.symbol,
      name: r.name,
      changePct: r.changePct ?? null,
      mainNetInflow: r.mainNetInflow ?? null,
      price: r.price ?? null,
    }));
}

/**
 * 按资金流榜远程选股：拉取 period 资金流排行 → 条件筛选 → 按主力净流入降序。
 * @param period 统计周期，默认今日
 * @param poolSize 先拉取的榜单长度（默认 300，避免一次打满全市场）
 */
export async function screenByFundFlow(
  criteria: RemoteScreenCriteria = {},
  period: FundFlowPeriod = 'today',
  poolSize = 300,
): Promise<RemoteScreenHit[]> {
  const rows = await marketData.getStockFundsFlowing({ period, limit: poolSize });
  return filterFundFlowRows(rows ?? [], criteria);
}

export interface SurgeScreenCriteria {
  /** 最多返回条数，默认 20 */
  limit?: number;
}

/**
 * 按今日异动（火箭发射等）远程选股。
 * 异动事件源字段不含涨跌幅，仅按事件时间顺序截断。
 */
export async function screenBySurge(
  criteria: SurgeScreenCriteria = {},
  type: StockChangeType = 'rocket_launch',
): Promise<RemoteScreenHit[]> {
  const rows = await marketData.getStockChangeEvents(type);
  const limit = criteria.limit ?? 20;
  return (rows ?? []).slice(0, limit).map((e) => ({
    symbol: e.symbol,
    name: e.name,
    changePct: null,
    mainNetInflow: null,
    price: null,
  }));
}
