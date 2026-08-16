/**
 * MethodCache —— 数据源方法读穿缓存（领域表优先，method_cache 兜底）。
 *
 * 架构原则（与 K 线 + 复权因子一致）：
 *  - 能按列建模的核心行情 → 领域表（DomainCacheStore）：
 *      getQuotes → quote_snapshot
 *      getTradingDays/isTradingDay → trading_calendar
 *      getMainForce → fund_flow
 *      getStockFundsFlowing → fund_flow_rank
 *      getLimit*Pool → limit_stock
 *      getStockIndustryBoard/getConceptBoards → board_quote
 *      getNorthboundMinute → northbound_minute
 *      getMarginAccountInfo → margin_account
 *      getDragonTigerStockStats → dragon_tiger_stat
 *  - 源结构不稳定、无稳定列可建模的 → method_cache（透传 JSON 兜底）
 *  - 复权价由「不复权价 + 复权因子」合成，不缓存已复权结果
 *
 * 读穿：命中未过期直接返回；未命中/过期 → fetch 并异步回写。
 * 写库失败不拖垮主请求；空结果默认不写。
 */
import { quantStore } from '@/db/QuantStore';
import { domainCache } from '@/db/DomainCacheStore';
import { domainCacheV6 } from '@/db/DomainCacheV6';
import { stableStringify } from './coalesce';
import type { DataSourceMethod, MethodArgs, MethodResult } from './methods';
import type { Quote, Symbol } from '@/api';
import { toFullCode } from '@/domain/symbol';

function n(v: unknown): number | null {
  if (v == null || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function n0(v: unknown): number {
  return n(v) ?? 0;
}
function s(v: unknown): string {
  return v == null ? '' : String(v);
}

export interface MethodCachePolicy {
  ttlMs: number;
  cacheEmpty?: boolean;
  /** 领域表路由：domain = 走领域表；fallback = 走 method_cache（仅极少数无列可建模） */
  store: 'domain' | 'fallback';
}

/** 方法 → 缓存策略。未列出 = 不缓存（如 K 线，由 KlineDatabase 负责）。 */
export const METHOD_CACHE_POLICIES: Partial<Record<DataSourceMethod, MethodCachePolicy>> = {
  // ---- v5 领域表 ----
  getQuotes: { ttlMs: 5_000, store: 'domain' },
  getIndexQuotes: { ttlMs: 5_000, store: 'domain' },
  getFundMarketSnapshot: { ttlMs: 5_000, store: 'domain' },
  getTradingDays: { ttlMs: 24 * 3600_000, store: 'domain', cacheEmpty: true },
  isTradingDay: { ttlMs: 24 * 3600_000, store: 'domain', cacheEmpty: true },
  getMainForce: { ttlMs: 5 * 60_000, store: 'domain' },
  getSectorFundFlowHistory: { ttlMs: 30 * 60_000, store: 'domain' },
  getStockFundsFlowing: { ttlMs: 2 * 60_000, store: 'domain' },
  getStockIndustryFundsFlowing: { ttlMs: 2 * 60_000, store: 'domain' },
  getLimitUpPool: { ttlMs: 5 * 60_000, store: 'domain' },
  getLimitDownPool: { ttlMs: 5 * 60_000, store: 'domain' },
  getLimitBreakPool: { ttlMs: 5 * 60_000, store: 'domain' },
  getStockIndustryBoard: { ttlMs: 2 * 60_000, store: 'domain' },
  getConceptBoards: { ttlMs: 2 * 60_000, store: 'domain' },
  getNorthboundMinute: { ttlMs: 5 * 60_000, store: 'domain' },
  getMarginAccountInfo: { ttlMs: 60 * 60_000, store: 'domain' },
  getDragonTigerStockStats: { ttlMs: 30 * 60_000, store: 'domain' },

  // ---- v6 领域表：财务 / 估值 / 分红 ----
  getValuations: { ttlMs: 60_000, store: 'domain' },
  getFinancials: { ttlMs: 12 * 3600_000, store: 'domain' },
  getIncomeStatements: { ttlMs: 12 * 3600_000, store: 'domain' },
  getBalanceSheets: { ttlMs: 12 * 3600_000, store: 'domain' },
  getCashFlowStatements: { ttlMs: 12 * 3600_000, store: 'domain' },
  getFinancialIndicators: { ttlMs: 12 * 3600_000, store: 'domain' },
  getDividendDetail: { ttlMs: 12 * 3600_000, store: 'domain' },
  getAdjustmentFactors: { ttlMs: 24 * 3600_000, store: 'domain' },

  // ---- v6 领域表：龙虎榜 / 天梯 / 热股 / 异动 ----
  getLimitUpLadder: { ttlMs: 30 * 60_000, store: 'domain' },
  getDragonTigerList: { ttlMs: 30 * 60_000, store: 'domain' },
  getDragonTigerInstitution: { ttlMs: 30 * 60_000, store: 'domain' },
  getDragonTigerBranchRank: { ttlMs: 30 * 60_000, store: 'domain' },
  getDragonTigerSeatDetail: { ttlMs: 30 * 60_000, store: 'domain' },
  getHotStockList: { ttlMs: 5 * 60_000, store: 'domain' },
  getSkyrocketList: { ttlMs: 5 * 60_000, store: 'domain' },
  getAnomalyList: { ttlMs: 2 * 60_000, store: 'domain' },
  getStockChangeEvents: { ttlMs: 2 * 60_000, store: 'domain' },
  getStockTodaySurge: { ttlMs: 2 * 60_000, store: 'domain' },
  getMarketFundFlow: { ttlMs: 10 * 60_000, store: 'domain' },

  // ---- v6 领域表：板块成分 / 北向明细 / 两融 / 大宗 / 竞价 ----
  getIndustryBoardConstituents: { ttlMs: 5 * 60_000, store: 'domain' },
  getConceptBoardConstituents: { ttlMs: 5 * 60_000, store: 'domain' },
  getNorthboundSummary: { ttlMs: 5 * 60_000, store: 'domain' },
  getNorthboundHoldingRank: { ttlMs: 60 * 60_000, store: 'domain' },
  getNorthboundHistory: { ttlMs: 60 * 60_000, store: 'domain' },
  getNorthboundIndividual: { ttlMs: 60 * 60_000, store: 'domain' },
  getMarginTargetList: { ttlMs: 60 * 60_000, store: 'domain' },
  getBlockTradeMarketStat: { ttlMs: 60 * 60_000, store: 'domain' },
  getBlockTradeDailyStat: { ttlMs: 60 * 60_000, store: 'domain' },
  getAuctionSnapshot: { ttlMs: 60_000, store: 'domain' },
  getShortTermBenchmark: { ttlMs: 30 * 60_000, store: 'domain' },

  // ---- v6 领域表：基金 / 筹码 / 期权 / 期货 / 指数 ----
  getFundProfile: { ttlMs: 24 * 3600_000, store: 'domain' },
  getFundHoldings: { ttlMs: 12 * 3600_000, store: 'domain' },
  getFundNav: { ttlMs: 60 * 60_000, store: 'domain' },
  getFundDividendList: { ttlMs: 12 * 3600_000, store: 'domain' },
  getFundRankHistory: { ttlMs: 12 * 3600_000, store: 'domain' },
  getChipDistribution: { ttlMs: 60 * 60_000, store: 'domain' },
  getOptionQuotes: { ttlMs: 5_000, store: 'domain' },
  getOptionKline: { ttlMs: 60_000, store: 'domain' },
  getOptionCffexQuotes: { ttlMs: 5_000, store: 'domain' },
  getOptionLhb: { ttlMs: 30 * 60_000, store: 'domain' },
  getFuturesKline: { ttlMs: 60_000, store: 'domain' },
  getFuturesGlobalSpot: { ttlMs: 5_000, store: 'domain' },
  getFuturesGlobalKline: { ttlMs: 60_000, store: 'domain' },
  getFuturesInventory: { ttlMs: 60 * 60_000, store: 'domain' },
  getFuturesComexInventory: { ttlMs: 60 * 60_000, store: 'domain' },
  listIndices: { ttlMs: 24 * 3600_000, store: 'domain' },
  getIndexConstituents: { ttlMs: 24 * 3600_000, store: 'domain' },
  getStockInfo: { ttlMs: 24 * 3600_000, store: 'domain' },

  // ---- 仅剩 fallback：实时性强/无稳定列（K 线不在此列）----
  getOrderBook: { ttlMs: 2_000, store: 'fallback' },
  getIntraday: { ttlMs: 30_000, store: 'fallback' },
  getLargeOrderRatios: { ttlMs: 5_000, store: 'fallback' },
  getMarketStatus: { ttlMs: 60_000, store: 'fallback' },
  search: { ttlMs: 6 * 3600_000, store: 'fallback' },
  listTickers: { ttlMs: 24 * 3600_000, store: 'fallback' },
  nextTradingDay: { ttlMs: 24 * 3600_000, store: 'fallback', cacheEmpty: true },
  prevTradingDay: { ttlMs: 24 * 3600_000, store: 'fallback', cacheEmpty: true },
  getIndividualChangeEvents: { ttlMs: 2 * 60_000, store: 'fallback' },
  getStockHotIndustry: { ttlMs: 2 * 60_000, store: 'fallback' },
  getBlockTrade: { ttlMs: 30 * 60_000, store: 'fallback' },
  getFundReturns: { ttlMs: 60 * 60_000, store: 'fallback' },
  getFundHolders: { ttlMs: 12 * 3600_000, store: 'fallback' },
  getFundHistorical: { ttlMs: 60 * 60_000, store: 'fallback' },
  getFuturesInventorySymbols: { ttlMs: 24 * 3600_000, store: 'fallback' },
};

/* ------------------------------ 键 ------------------------------ */

export function methodCacheKey(method: DataSourceMethod, args: unknown[]): string {
  return `${method}.${stableStringify(args)}`;
}

function isEmptyResult(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function todayYmd(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/* ------------------------------ 领域读 ------------------------------ */

async function readDomain(
  method: DataSourceMethod,
  args: unknown[],
  now: number,
): Promise<unknown | null> {
  const dc = domainCache();

  switch (method) {
    case 'getQuotes':
    case 'getIndexQuotes':
    case 'getFundMarketSnapshot': {
      // args[0] = Symbol[] | Symbol
      const raw = args[0];
      const symbols: Symbol[] = Array.isArray(raw)
        ? (raw as Symbol[])
        : raw
          ? [raw as Symbol]
          : [];
      if (symbols.length === 0) return null;
      const map = await dc.getQuotes(symbols, now);
      const out = symbols.map((s) => map.get(toFullCode(s))).filter(Boolean) as Quote[];
      return out.length > 0 ? out : null;
    }
    case 'getTradingDays': {
      const days = await dc.listTradingDays();
      return days.length > 0 ? days.map((d) => ({ dateMs: d.dateMs, date: d.date })) : null;
    }
    case 'isTradingDay': {
      const date = (args[0] as string | undefined) ?? todayYmd();
      const hit = await dc.isTradingDay(date);
      return hit; // null = 未缓存
    }
    case 'getMainForce':
    case 'getSectorFundFlowHistory': {
      const p = args[0] as { symbol?: Symbol; code?: string } | undefined;
      const sym = p?.symbol;
      if (!sym) return null;
      const rows = await dc.listFundFlow(toFullCode(sym));
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        date: r.tradeDate,
        close: r.closePrice,
        changePct: r.changePct,
        mainNetInflow: r.mainNetInflow,
        mainNetInflowPct: r.mainInflowPct,
        superLargeNetInflow: r.superLargeInflow,
        largeNetInflow: r.largeInflow,
        mediumNetInflow: r.mediumInflow,
        smallNetInflow: r.smallInflow,
      }));
    }
    case 'getStockFundsFlowing': {
      const rows = await dc.listFundFlowRank('stock', 'today', now);
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        symbol: { code: r.code, exchange: (r.exchange || 'SH') as Symbol['exchange'] },
        name: r.name,
        price: r.price,
        changePct: r.changePct,
        mainNetInflow: r.mainNetInflow,
        mainNetInflowPct: r.mainInflowPct,
      }));
    }
    case 'getStockIndustryFundsFlowing': {
      const rows = await dc.listFundFlowRank('industry', 'today', now);
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        code: r.code,
        name: r.name,
        changePct: r.changePct,
        mainNetInflow: r.mainNetInflow,
        mainNetInflowPct: r.mainInflowPct,
        topStockCode: r.topStockCode,
        topStockName: r.topStockName,
      }));
    }
    case 'getLimitUpPool':
    case 'getLimitDownPool':
    case 'getLimitBreakPool': {
      const poolType =
        method === 'getLimitUpPool' ? 'up' : method === 'getLimitDownPool' ? 'down' : 'break';
      const date = todayYmd();
      const rows = await dc.listLimitStocks(poolType, date, now);
      if (rows.length === 0) return null;
      return {
        items: rows.map((r) => ({
          symbol: { code: r.code, exchange: (r.exchange || 'SH') as Symbol['exchange'] },
          name: r.name,
          lastPrice: r.lastPrice ?? 0,
          changePct: r.changePct ?? 0,
          continueDayCnt: r.boardDays ?? 0,
          // 字段按池类型补齐到强类型契约
          ...(poolType === 'up'
            ? {
                isSt: false,
                isNew: false,
                limitUpTime: r.firstLimitTime ?? '',
                limitUpReason: '',
                continueDayText: String(r.boardDays ?? ''),
                sealMoney: r.sealMoney ?? 0,
                maxSealMoney: r.sealMoney ?? 0,
              }
            : {}),
        })),
      };
    }
    case 'getStockIndustryBoard':
    case 'getConceptBoards': {
      const boardType = method === 'getStockIndustryBoard' ? 'industry' : 'concept';
      const rows = await dc.listBoards(boardType, now);
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        code: r.code,
        name: r.name,
        rank: r.rankNo ?? undefined,
        price: r.price,
        changePct: r.changePct,
        totalMarketCap: r.totalMarketCap,
        turnoverRate: r.turnoverRate,
        riseCount: r.riseCount,
        fallCount: r.fallCount,
        leadingStock: r.leadingStock,
      }));
    }
    case 'getNorthboundMinute': {
      const dir = (args[0] as string | undefined) ?? 'north';
      const rows = await dc.listNorthboundMinute(dir, now);
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        date: r.tradeDate,
        time: r.tradeTime,
        shanghaiNetInflow: r.shNetInflow,
        shenzhenNetInflow: r.szNetInflow,
        totalNetInflow: r.totalNetInflow,
      }));
    }
    case 'getMarginAccountInfo': {
      const rows = await dc.listMarginAccounts(now);
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        date: r.tradeDate,
        finBalance: r.finBalance,
        loanBalance: r.loanBalance,
        finBuyAmount: r.finBuyAmount,
        loanSellAmount: r.loanSellAmount,
        investorCount: r.investorCount,
        liabilityInvestorCount: r.liabilityInvestorCount,
        totalGuarantee: r.totalGuarantee,
        avgGuaranteeRatio: r.avgGuaranteeRatio,
      }));
    }
    case 'getDragonTigerStockStats': {
      const period = (args[0] as string | undefined) ?? '1month';
      const rows = await dc.listDragonTigerStats(period, now);
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        symbol: { code: r.code, exchange: (r.code.startsWith('6') ? 'SH' : 'SZ') as Symbol['exchange'] },
        name: r.name,
        latestDate: r.latestDate ?? '',
        close: r.closePrice,
        changePct: r.changePct,
        count: r.listCount,
        totalBuyAmount: r.totalBuyAmount,
        totalSellAmount: r.totalSellAmount,
        totalNetAmount: r.totalNetAmount,
      }));
    }

    // ---- v6：财务 / 估值 / 指数 / 档案 ----
    case 'getValuations': {
      const raw = args[0] as Symbol[] | undefined;
      if (!raw || raw.length === 0) return null;
      const keys = raw.map(toFullCode);
      const rows = await domainCacheV6().listValuations(keys, now);
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        symbol: { code: s(r.code), exchange: s(r.exchange) as Symbol['exchange'] },
        name: r.name == null ? null : s(r.name),
        peTtm: n(r.pe_ttm),
        peMrq: n(r.pe_mrq),
        pbMrq: n(r.pb_mrq),
        psTtm: n(r.ps_ttm),
        pcfTtm: n(r.pcf_ttm),
        timestamp: r.timestamp == null ? null : n0(r.timestamp),
      }));
    }
    case 'getFinancials': {
      const code = String(args[0] ?? '');
      const rows = await domainCacheV6().listFinancialReports(code);
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        symbol: { code: s(r.code), exchange: s(r.exchange) as Symbol['exchange'] },
        period: s(r.period),
        periodEndMs: n0(r.period_end_ms),
        basicEps: n(r.basic_eps),
        operatingIncome: n(r.operating_income),
        operatingCosts: n(r.operating_costs),
        netProfit: n(r.net_profit),
        parentHolderNetProfit: n(r.parent_holder_net_profit),
        totalAssets: n(r.total_assets),
        holderEquityTotal: n(r.holder_equity_total),
        operatingCashFlow: n(r.operating_cash_flow),
      }));
    }
    case 'getStockInfo': {
      const code = String(args[0] ?? '');
      const r = await domainCacheV6().getStockInfo(code, now);
      if (!r) return null;
      try {
        return r.payload ? JSON.parse(s(r.payload)) : { code, name: s(r.name), industry: s(r.industry) };
      } catch {
        return { code, name: s(r.name), industry: s(r.industry) };
      }
    }
    case 'listIndices': {
      const tag = (args[0] as string | undefined) ?? 'industry';
      const rows = await domainCacheV6().listIndexCatalog(tag, now);
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        symbol: { code: s(r.code), exchange: 'TI' as Symbol['exchange'] },
        name: s(r.name),
      }));
    }
    case 'getIndexConstituents': {
      const sym = args[0] as Symbol | undefined;
      if (!sym) return null;
      const rows = await domainCacheV6().listIndexConstituents(toFullCode(sym), now);
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        symbol: { code: s(r.code), exchange: 'SH' as Symbol['exchange'] },
        name: s(r.name),
      }));
    }
    case 'getHotStockList':
    case 'getSkyrocketList': {
      const listType = method === 'getHotStockList' ? 'hot' : 'skyrocket';
      const period = (args[0] as string | undefined) ?? 'day';
      const rows = await domainCacheV6().listHotStocks(listType, period, now);
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        symbol: { code: s(r.code), exchange: (s(r.code).startsWith('6') ? 'SH' : 'SZ') as Symbol['exchange'] },
        name: s(r.name),
        rank: n0(r.rank_no),
        heat: n0(r.heat),
        rankChange: n0(r.rank_change),
        rankTrend: s(r.rank_trend),
      }));
    }
    case 'getMarketFundFlow': {
      const rows = await domainCacheV6().listMarketFundFlows(now);
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        date: s(r.trade_date),
        shClose: n(r.sh_close),
        shChangePct: n(r.sh_change_pct),
        szClose: n(r.sz_close),
        szChangePct: n(r.sz_change_pct),
        mainNetInflow: n(r.main_net_inflow),
        mainNetInflowPct: n(r.main_inflow_pct),
        superLargeNetInflow: n(r.super_large_inflow),
        largeNetInflow: n(r.large_inflow),
        mediumNetInflow: n(r.medium_inflow),
        smallNetInflow: n(r.small_inflow),
      }));
    }
    case 'getIndustryBoardConstituents':
    case 'getConceptBoardConstituents': {
      const boardType = method === 'getIndustryBoardConstituents' ? 'industry' : 'concept';
      const sym = args[0] as Symbol | undefined;
      if (!sym) return null;
      const rows = await domainCacheV6().listBoardConstituents(boardType, toFullCode(sym), now);
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        symbol: { code: s(r.code), exchange: (s(r.code).startsWith('6') ? 'SH' : 'SZ') as Symbol['exchange'] },
        name: s(r.name),
        rank: r.rank_no == null ? undefined : n0(r.rank_no),
        price: n(r.price),
        changePct: n(r.change_pct),
        volume: n(r.volume),
        amount: n(r.amount),
      }));
    }
    case 'getNorthboundSummary': {
      const rows = await domainCacheV6().listNorthboundSummaries(now);
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        date: s(r.trade_date),
        boardName: s(r.board_name),
        direction: s(r.direction),
        status: s(r.status),
        netBuyAmount: n(r.net_buy_amount),
        netInflow: n(r.net_inflow),
        remainAmount: n(r.remain_amount),
        upCount: n(r.up_count),
        downCount: n(r.down_count),
        flatCount: n(r.flat_count),
        indexCode: s(r.index_code),
        indexName: s(r.index_name),
        indexChangePct: n(r.index_change_pct),
      }));
    }
    case 'getNorthboundHistory': {
      const p = args[0] as { direction?: string } | undefined;
      const dir = p?.direction ?? 'north';
      const rows = await domainCacheV6().listNorthboundHistory(dir, now);
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        date: s(r.trade_date),
        netBuyAmount: n(r.net_buy_amount),
        buyAmount: n(r.buy_amount),
        sellAmount: n(r.sell_amount),
        accNetBuyAmount: n(r.acc_net_buy_amount),
        netInflow: n(r.net_inflow),
        remainAmount: n(r.remain_amount),
        topStockCode: r.top_stock_code == null ? null : s(r.top_stock_code),
        topStockName: r.top_stock_name == null ? null : s(r.top_stock_name),
        topStockChangePct: n(r.top_stock_change_pct),
      }));
    }
    case 'getFundProfile': {
      const sym = args[0] as Symbol | undefined;
      if (!sym) return null;
      const r = await domainCacheV6().getFundProfile(toFullCode(sym), now);
      if (!r) return null;
      return {
        symbol: sym,
        ticker: s(r.ticker),
        fundName: r.fund_name == null ? null : s(r.fund_name),
        estabDateMs: r.estab_date_ms == null ? null : n0(r.estab_date_ms),
        mgmtName: r.mgmt_name == null ? null : s(r.mgmt_name),
        managerName: r.manager_name == null ? null : s(r.manager_name),
      };
    }
    case 'getFundNav': {
      const sym = args[0] as Symbol | undefined;
      if (!sym) return null;
      const rows = await domainCacheV6().listFundNavs(toFullCode(sym));
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        symbol: sym,
        navDate: s(r.nav_date),
        unitNav: n(r.unit_nav),
        adjNav: n(r.adj_nav),
      }));
    }
    case 'getAdjustmentFactors': {
      const sym = args[0] as Symbol | undefined;
      if (!sym) return null;
      const rows = await domainCacheV6().listAdjustmentFactors(toFullCode(sym));
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        symbol: sym,
        ticker: s(r.ticker),
        exDateMs: n0(r.ex_date_ms),
        dividendPerShare: n(r.dividend_per_share),
        perShareBonus: n(r.per_share_bonus),
        allotmentRatio: n(r.allotment_ratio),
        allotmentPrice: n(r.allotment_price),
      }));
    }
    default:
      return null;
  }
}

/* ------------------------------ 领域写 ------------------------------ */

async function writeDomain(
  method: DataSourceMethod,
  args: unknown[],
  result: unknown,
  ttlMs: number,
  now: number,
): Promise<void> {
  const dc = domainCache();

  switch (method) {
    case 'getQuotes':
    case 'getIndexQuotes':
    case 'getFundMarketSnapshot': {
      const quotes = (Array.isArray(result) ? result : result ? [result] : []) as Quote[];
      await dc.putQuotes(quotes, ttlMs, now);
      return;
    }
    case 'getTradingDays': {
      const days = (result ?? []) as { dateMs: number; date: string }[];
      await dc.putTradingDays(days, now);
      return;
    }
    case 'isTradingDay': {
      const date = (args[0] as string | undefined) ?? todayYmd();
      if (typeof result === 'boolean') {
        // 单日标记：用 putTradingDays 写 is_trading
        await dc.putTradingDays(
          [{ date, dateMs: new Date(date).getTime() }],
          now,
        );
      }
      return;
    }
    case 'getMainForce':
    case 'getSectorFundFlowHistory': {
      const p = args[0] as { symbol?: Symbol } | undefined;
      const sym = p?.symbol;
      if (!sym) return;
      const list = (result ?? []) as Array<Record<string, unknown>>;
      await dc.putFundFlow(
        list.map((it) => ({
          symbolKey: toFullCode(sym),
          code: sym.code,
          exchange: sym.exchange,
          tradeDate: String(it.date ?? ''),
          closePrice: (it.close as number) ?? null,
          changePct: (it.changePct as number) ?? null,
          mainNetInflow: (it.mainNetInflow as number) ?? null,
          mainInflowPct: (it.mainNetInflowPct as number) ?? null,
          superLargeInflow: (it.superLargeNetInflow as number) ?? null,
          largeInflow: (it.largeNetInflow as number) ?? null,
          mediumInflow: (it.mediumNetInflow as number) ?? null,
          smallInflow: (it.smallNetInflow as number) ?? null,
        })).filter((r) => r.tradeDate),
        now,
      );
      return;
    }
    case 'getStockFundsFlowing': {
      const list = (result ?? []) as Array<{
        symbol?: Symbol; name?: string; price?: number | null;
        changePct?: number | null; mainNetInflow?: number | null; mainNetInflowPct?: number | null;
      }>;
      await dc.putFundFlowRank(
        'stock', 'today',
        list.map((it, i) => ({
          rankNo: i + 1,
          code: it.symbol?.code ?? '',
          name: it.name ?? '',
          exchange: it.symbol?.exchange ?? '',
          price: it.price ?? null,
          changePct: it.changePct ?? null,
          mainNetInflow: it.mainNetInflow ?? null,
          mainInflowPct: it.mainNetInflowPct ?? null,
          topStockCode: null,
          topStockName: null,
        })),
        ttlMs, now,
      );
      return;
    }
    case 'getStockIndustryFundsFlowing': {
      const list = (result ?? []) as Array<Record<string, unknown>>;
      await dc.putFundFlowRank(
        'industry', 'today',
        list.map((it, i) => ({
          rankNo: i + 1,
          code: String(it.code ?? ''),
          name: String(it.name ?? ''),
          exchange: '',
          price: null,
          changePct: (it.changePct as number) ?? null,
          mainNetInflow: (it.mainNetInflow as number) ?? null,
          mainInflowPct: (it.mainNetInflowPct as number) ?? null,
          topStockCode: it.topStockCode ? String(it.topStockCode) : null,
          topStockName: it.topStockName ? String(it.topStockName) : null,
        })),
        ttlMs, now,
      );
      return;
    }
    case 'getLimitUpPool':
    case 'getLimitDownPool':
    case 'getLimitBreakPool': {
      const poolType =
        method === 'getLimitUpPool' ? 'up' : method === 'getLimitDownPool' ? 'down' : 'break';
      const date = todayYmd();
      const wrapped = result as { items?: unknown[] } | unknown[] | null;
      const list = (Array.isArray(wrapped) ? wrapped : wrapped?.items ?? []) as Array<Record<string, unknown>>;
      await dc.putLimitStocks(
        poolType, date,
        list.map((it) => {
          const sym = it.symbol as Symbol | undefined;
          return {
            code: sym?.code ?? String(it.code ?? ''),
            exchange: sym?.exchange ?? '',
            name: String(it.name ?? ''),
            lastPrice: (it.lastPrice as number) ?? null,
            changePct: (it.changePct as number) ?? null,
            boardDays: (it.continueDayCnt as number) ?? null,
            sealMoney: (it.sealMoney as number) ?? null,
            firstLimitTime: it.limitUpTime ? String(it.limitUpTime) : null,
            lastLimitTime: it.lastLimitTime ? String(it.lastLimitTime) : null,
            turnoverPct: (it.turnoverRatioPct as number) ?? null,
            openTimes: (it.openTimes as number) ?? null,
          };
        }),
        ttlMs, now,
      );
      return;
    }
    case 'getStockIndustryBoard':
    case 'getConceptBoards': {
      const boardType = method === 'getStockIndustryBoard' ? 'industry' : 'concept';
      const list = (result ?? []) as Array<Record<string, unknown>>;
      await dc.putBoards(
        boardType,
        list.map((it) => ({
          code: String(it.code ?? ''),
          name: String(it.name ?? ''),
          rankNo: (it.rank as number) ?? null,
          price: (it.price as number) ?? null,
          changePct: (it.changePct as number) ?? null,
          totalMarketCap: (it.totalMarketCap as number) ?? (it.amount as number) ?? null,
          turnoverRate: (it.turnoverRate as number) ?? null,
          riseCount: (it.riseCount as number) ?? null,
          fallCount: (it.fallCount as number) ?? null,
          leadingStock: it.leadingStock ? String(it.leadingStock) : null,
        })),
        ttlMs, now,
      );
      return;
    }
    case 'getNorthboundMinute': {
      const dir = (args[0] as string | undefined) ?? 'north';
      const list = (result ?? []) as Array<Record<string, unknown>>;
      await dc.putNorthboundMinute(
        dir,
        list.map((it) => ({
          tradeDate: String(it.date ?? ''),
          tradeTime: String(it.time ?? ''),
          shNetInflow: (it.shanghaiNetInflow as number) ?? null,
          szNetInflow: (it.shenzhenNetInflow as number) ?? null,
          totalNetInflow: (it.totalNetInflow as number) ?? null,
        })).filter((r) => r.tradeDate),
        ttlMs, now,
      );
      return;
    }
    case 'getMarginAccountInfo': {
      const list = (result ?? []) as Array<Record<string, unknown>>;
      await dc.putMarginAccounts(
        list.map((it) => ({
          tradeDate: String(it.date ?? ''),
          finBalance: (it.finBalance as number) ?? null,
          loanBalance: (it.loanBalance as number) ?? null,
          finBuyAmount: (it.finBuyAmount as number) ?? null,
          loanSellAmount: (it.loanSellAmount as number) ?? null,
          investorCount: (it.investorCount as number) ?? null,
          liabilityInvestorCount: (it.liabilityInvestorCount as number) ?? null,
          totalGuarantee: (it.totalGuarantee as number) ?? null,
          avgGuaranteeRatio: (it.avgGuaranteeRatio as number) ?? null,
        })).filter((r) => r.tradeDate),
        ttlMs, now,
      );
      return;
    }
    case 'getDragonTigerStockStats': {
      const period = (args[0] as string | undefined) ?? '1month';
      const list = (result ?? []) as Array<Record<string, unknown>>;
      await dc.putDragonTigerStats(
        period,
        list.map((it, i) => ({
          rankNo: i + 1,
          code: String(it.symbol ? (it.symbol as Symbol).code : it.code ?? ''),
          name: String(it.name ?? ''),
          latestDate: it.latestDate ? String(it.latestDate) : null,
          closePrice: (it.close as number) ?? null,
          changePct: (it.changePct as number) ?? null,
          listCount: (it.count as number) ?? null,
          totalBuyAmount: (it.totalBuyAmount as number) ?? null,
          totalSellAmount: (it.totalSellAmount as number) ?? null,
          totalNetAmount: (it.totalNetAmount as number) ?? null,
        })),
        ttlMs, now,
      );
      return;
    }

    // ---- v6 写 ----
    case 'getValuations': {
      const list = (result ?? []) as Array<Record<string, unknown>>;
      await domainCacheV6().putValuations(
        list.map((it) => {
          const sym = it.symbol as Symbol | undefined;
          return {
            symbol_key: sym ? toFullCode(sym) : '',
            code: sym?.code ?? '',
            exchange: sym?.exchange ?? '',
            name: it.name == null ? null : String(it.name),
            pe_ttm: it.peTtm as number | null,
            pe_mrq: it.peMrq as number | null,
            pb_mrq: it.pbMrq as number | null,
            ps_ttm: it.psTtm as number | null,
            pcf_ttm: it.pcfTtm as number | null,
            timestamp: it.timestamp as number | null,
          };
        }).filter((r) => r.symbol_key),
        ttlMs, now,
      );
      return;
    }
    case 'getFinancials': {
      const code = String(args[0] ?? '');
      const list = (result ?? []) as Array<Record<string, unknown>>;
      await domainCacheV6().putFinancialReports(
        code,
        list.map((it) => {
          const sym = it.symbol as Symbol | undefined;
          return {
            code: sym?.code ?? code,
            exchange: sym?.exchange ?? '',
            period: it.period ?? '',
            period_end_ms: it.periodEndMs ?? 0,
            basic_eps: it.basicEps,
            operating_income: it.operatingIncome,
            operating_costs: it.operatingCosts,
            net_profit: it.netProfit,
            parent_holder_net_profit: it.parentHolderNetProfit,
            total_assets: it.totalAssets,
            holder_equity_total: it.holderEquityTotal,
            operating_cash_flow: it.operatingCashFlow,
          };
        }),
        now,
      );
      return;
    }
    case 'getStockInfo': {
      const code = String(args[0] ?? '');
      const obj = (result ?? {}) as Record<string, unknown>;
      await domainCacheV6().putStockInfo(
        code,
        {
          code,
          name: obj.name == null ? null : String(obj.name),
          industry: obj.industry == null ? null : String(obj.industry),
          payload: JSON.stringify(result ?? null),
        },
        ttlMs, now,
      );
      return;
    }
    case 'listIndices': {
      const tag = (args[0] as string | undefined) ?? 'industry';
      const list = (result ?? []) as Array<{ symbol?: Symbol; name?: string }>;
      await domainCacheV6().putIndexCatalog(
        tag,
        list.map((it) => ({
          tag,
          code: it.symbol?.code ?? '',
          name: it.name ?? '',
        })).filter((r) => r.code),
        ttlMs, now,
      );
      return;
    }
    case 'getIndexConstituents': {
      const sym = args[0] as Symbol | undefined;
      if (!sym) return;
      const list = (result ?? []) as Array<{ symbol?: Symbol; name?: string }>;
      await domainCacheV6().putIndexConstituents(
        toFullCode(sym),
        list.map((it) => ({
          index_code: toFullCode(sym),
          code: it.symbol?.code ?? '',
          name: it.name ?? '',
        })).filter((r) => r.code),
        ttlMs, now,
      );
      return;
    }
    case 'getHotStockList':
    case 'getSkyrocketList': {
      const listType = method === 'getHotStockList' ? 'hot' : 'skyrocket';
      const period = (args[0] as string | undefined) ?? 'day';
      const list = (result ?? []) as Array<Record<string, unknown>>;
      await domainCacheV6().putHotStocks(
        listType, period,
        list.map((it, i) => {
          const sym = it.symbol as Symbol | undefined;
          return {
            list_type: listType,
            period,
            rank_no: i + 1,
            code: sym?.code ?? '',
            name: it.name ?? '',
            heat: it.heat as number,
            rank_change: it.rankChange as number,
            rank_trend: it.rankTrend ? String(it.rankTrend) : null,
          };
        }).filter((r) => r.code),
        ttlMs, now,
      );
      return;
    }
    case 'getMarketFundFlow': {
      const list = (result ?? []) as Array<Record<string, unknown>>;
      await domainCacheV6().putMarketFundFlows(
        list.map((it) => ({
          trade_date: it.date ?? '',
          sh_close: it.shClose,
          sh_change_pct: it.shChangePct,
          sz_close: it.szClose,
          sz_change_pct: it.szChangePct,
          main_net_inflow: it.mainNetInflow,
          main_inflow_pct: it.mainNetInflowPct,
          super_large_inflow: it.superLargeNetInflow,
          large_inflow: it.largeNetInflow,
          medium_inflow: it.mediumNetInflow,
          small_inflow: it.smallNetInflow,
        })).filter((r) => r.trade_date),
        ttlMs, now,
      );
      return;
    }
    case 'getIndustryBoardConstituents':
    case 'getConceptBoardConstituents': {
      const boardType = method === 'getIndustryBoardConstituents' ? 'industry' : 'concept';
      const sym = args[0] as Symbol | undefined;
      if (!sym) return;
      const list = (result ?? []) as Array<Record<string, unknown>>;
      await domainCacheV6().putBoardConstituents(
        boardType, toFullCode(sym),
        list.map((it) => {
          const s2 = it.symbol as Symbol | undefined;
          return {
            board_type: boardType,
            board_code: toFullCode(sym),
            code: s2?.code ?? '',
            name: it.name ?? '',
            rank_no: it.rank as number,
            price: it.price as number,
            change_pct: it.changePct as number,
            volume: it.volume as number,
            amount: it.amount as number,
            turnover_rate: it.turnoverRate as number,
            pe: it.pe as number,
            pb: it.pb as number,
          };
        }).filter((r) => r.code),
        ttlMs, now,
      );
      return;
    }
    case 'getNorthboundSummary': {
      const list = (result ?? []) as Array<Record<string, unknown>>;
      await domainCacheV6().putNorthboundSummaries(
        list.map((it) => ({
          trade_date: it.date ?? '',
          board_name: it.boardName ?? '',
          direction: it.direction ?? '',
          status: it.status,
          net_buy_amount: it.netBuyAmount,
          net_inflow: it.netInflow,
          remain_amount: it.remainAmount,
          up_count: it.upCount,
          down_count: it.downCount,
          flat_count: it.flatCount,
          index_code: it.indexCode,
          index_name: it.indexName,
          index_change_pct: it.indexChangePct,
        })).filter((r) => r.trade_date && r.board_name),
        ttlMs, now,
      );
      return;
    }
    case 'getNorthboundHistory': {
      const p = args[0] as { direction?: string } | undefined;
      const dir = p?.direction ?? 'north';
      const list = (result ?? []) as Array<Record<string, unknown>>;
      await domainCacheV6().putNorthboundHistory(
        dir,
        list.map((it) => ({
          trade_date: it.date ?? '',
          direction: dir,
          net_buy_amount: it.netBuyAmount,
          buy_amount: it.buyAmount,
          sell_amount: it.sellAmount,
          acc_net_buy_amount: it.accNetBuyAmount,
          net_inflow: it.netInflow,
          remain_amount: it.remainAmount,
          top_stock_code: it.topStockCode,
          top_stock_name: it.topStockName,
          top_stock_change_pct: it.topStockChangePct,
        })).filter((r) => r.trade_date),
        ttlMs, now,
      );
      return;
    }
    case 'getFundProfile': {
      const sym = args[0] as Symbol | undefined;
      if (!sym) return;
      const obj = (result ?? {}) as Record<string, unknown>;
      await domainCacheV6().putFundProfile(
        toFullCode(sym),
        {
          ticker: obj.ticker ?? '',
          fund_name: obj.fundName,
          estab_date_ms: obj.estabDateMs,
          mgmt_name: obj.mgmtName,
          manager_name: obj.managerName,
        },
        ttlMs, now,
      );
      return;
    }
    case 'getFundNav': {
      const sym = args[0] as Symbol | undefined;
      if (!sym) return;
      const list = (result ?? []) as Array<Record<string, unknown>>;
      await domainCacheV6().putFundNavs(
        toFullCode(sym),
        list.map((it) => ({
          nav_date: it.navDate ?? '',
          unit_nav: it.unitNav,
          adj_nav: it.adjNav,
        })).filter((r) => r.nav_date),
        now,
      );
      return;
    }
    case 'getAdjustmentFactors': {
      const sym = args[0] as Symbol | undefined;
      if (!sym) return;
      const list = (result ?? []) as Array<Record<string, unknown>>;
      await domainCacheV6().putAdjustmentFactors(
        toFullCode(sym),
        list.map((it) => ({
          ticker: it.ticker ?? '',
          ex_date_ms: it.exDateMs ?? 0,
          dividend_per_share: it.dividendPerShare,
          per_share_bonus: it.perShareBonus,
          allotment_ratio: it.allotmentRatio,
          allotment_price: it.allotmentPrice,
        })).filter((r) => r.ex_date_ms),
        now,
      );
      return;
    }
    default:
      return;
  }
}

/* ------------------------------ 读穿主路径 ------------------------------ */

/**
 * 读穿：领域表优先 → method_cache 兜底 → fetch。
 */
export async function readThroughCache<M extends DataSourceMethod>(
  method: M,
  args: MethodArgs<M>,
  fetch: () => Promise<MethodResult<M>>,
): Promise<MethodResult<M>> {
  const policy = METHOD_CACHE_POLICIES[method];
  if (!policy) {
    return fetch();
  }
  const now = Date.now();

  // 1) 领域表读
  if (policy.store === 'domain') {
    try {
      const hit = await readDomain(method, args as unknown[], now);
      if (hit !== null && hit !== undefined) {
        if (!isEmptyResult(hit) || policy.cacheEmpty) {
          return hit as MethodResult<M>;
        }
      }
    } catch {
      // 领域读失败 → 当 miss
    }
    // 空结果哨兵：领域表无数据时也查 method_cache（cacheEmpty 场景）
    if (policy.cacheEmpty) {
      const key = methodCacheKey(method, args as unknown[]);
      try {
        const hit = await quantStore().getMethodCache(key, now);
        if (hit) {
          return JSON.parse(hit.payload) as MethodResult<M>;
        }
      } catch {
        // 当 miss
      }
    }
  }

  // 2) fallback 表读
  if (policy.store === 'fallback') {
    const key = methodCacheKey(method, args as unknown[]);
    try {
      const hit = await quantStore().getMethodCache(key, now);
      if (hit) {
        const v = JSON.parse(hit.payload) as MethodResult<M>;
        if (!isEmptyResult(v) || policy.cacheEmpty) {
          return v;
        }
      }
    } catch {
      // 当 miss
    }
  }

  // 3) fetch
  const result = await fetch();

  // 4) 异步回写
  const shouldWrite = !isEmptyResult(result) || policy.cacheEmpty === true;
  if (shouldWrite) {
    const key = methodCacheKey(method, args as unknown[]);
    // 领域方法：非空走领域表；空结果且 cacheEmpty 写 method_cache 哨兵
    const useDomain = policy.store === 'domain' && !isEmptyResult(result);
    if (useDomain) {
      void writeDomain(method, args as unknown[], result, policy.ttlMs, now).catch(() => {});
    } else {
      void quantStore()
        .putMethodCache({
          cacheKey: key,
          method,
          argsHash: stableStringify(args as unknown[]).slice(0, 256),
          payload: JSON.stringify(result ?? null),
          updatedAt: now,
          expiresAt: now + policy.ttlMs,
        })
        .catch(() => {});
    }
  }
  return result;
}

/** 清理过期缓存（领域表 + method_cache）。 */
export async function pruneMethodCache(now: number = Date.now()): Promise<number> {
  const a = await domainCache().pruneExpired(now);
  const b = await quantStore().pruneMethodCache(now);
  const c = await domainCacheV6().pruneExpired(now);
  return a + b + c;
}

/** 测试辅助：清一条 fallback 缓存 */
export async function clearMethodCache(method: DataSourceMethod, args: unknown[]): Promise<void> {
  await quantStore().clearMethodCache(methodCacheKey(method, args));
}
