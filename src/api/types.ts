/**
 * 行情/财务/估值/指数/基金/特色数据领域统一类型定义。
 *
 * 设计原则：
 *  - 所有数据源（同花顺官方 REST / stock-api）都把外部结构归一化到这里；
 *  - 上层（feature / ui）完全不感知具体数据源差异；
 *  - 时间统一用毫秒时间戳（number）或 ISO 字符串，避免 Date 对象跨层传递；
 *  - 可空字段保持 null，绝不补零（遵循同花顺契约的空值语义）。
 */

/** 市场分类 */
export type Market = 'A' | 'HK' | 'US';

/** 交易所 / 资产后缀 */
export type Exchange = 'SH' | 'SZ' | 'BJ' | 'HK' | 'TI' | 'OF' | 'US';

/** 资产类别 */
export type AssetType =
  | 'a-share'
  | 'a-share-index'
  | 'forex'
  | 'fund-otc'
  | 'fund-etf'
  | 'fund-lof'
  | 'fund-reits';

/** 统一后的标的标识（thscode 风格，例如 600519.SH / 00700.HK / 886042.TI） */
export interface Symbol {
  /** 原始代码，不含交易所后缀，例如 600519 / 00700 */
  code: string;
  /** 交易所后缀 */
  exchange: Exchange;
  /** 展示名（可选，部分接口才有） */
  name?: string;
}

/** K 线周期。注意：同花顺官方仅支持日线 1d；分钟级由 stock-api 兜底 */
export type KlinePeriod = 'day' | 'week' | 'month' | '1m' | '5m' | '15m' | '30m' | '60m';

/** 复权方式 */
export type AdjustMode = 'none' | 'forward' | 'backward';

/** 单根 K 线 */
export interface Candle {
  /** 时间，毫秒时间戳或 ISO 字符串 */
  datetime: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** 成交量（股） */
  volume: number;
  /** 成交额（元），可选 */
  amount?: number;
}

/** 实时行情快照 */
export interface Quote {
  symbol: Symbol;
  /** 最新价 */
  last: number;
  /** 昨收 */
  prevClose: number;
  /** 今开 */
  open: number;
  /** 最高 */
  high: number;
  /** 最低 */
  low: number;
  /** 成交量（股） */
  volume: number;
  /** 成交额（元） */
  amount: number;
  /** 涨跌幅（百分比数值，如 1.74 表示 +1.74%） */
  changePct?: number;
  /** 涨跌额 */
  change?: number;
  /** 振幅百分比 */
  amplitudePct?: number;
  /** 更新时间（毫秒） */
  updatedAt?: number;
}

/** 五档盘口（stock-api 兜底源支持） */
export interface OrderBook {
  symbol: Symbol;
  bids: Array<{ price: number; volume: number }>;
  asks: Array<{ price: number; volume: number }>;
  updatedAt: number;
}

/** 基础标的信息 */
export interface Instrument {
  symbol: Symbol;
  /** 中文简称 */
  name: string;
  /** 市场 */
  market: Market;
  /** 资产类别 */
  assetType?: AssetType;
  /** 币种 */
  currency?: string;
}

// ============ 估值 ============
export interface Valuation {
  symbol: Symbol;
  name?: string | null;
  peTtm: number | null;
  peMrq: number | null;
  pbMrq: number | null;
  psTtm: number | null;
  pcfTtm: number | null;
  /** 数据时间（毫秒） */
  timestamp?: number | null;
}

// ============ 财务报表 ============
export type ReportPeriod = 'annual' | 'quarterly';

export interface IncomeStatement {
  symbol: Symbol;
  period: ReportPeriod;
  periodEndMs: number;
  reportDateMs: number;
  fiscalYear: number;
  fiscalPeriod: string;
  currency: string;
  basicEps: number | null;
  operatingIncome: number | null;
  operatingCosts: number | null;
  operatingExpenses: number | null;
  operatingProfit: number | null;
  profitTotal: number | null;
  netProfit: number | null;
  parentHolderNetProfit: number | null;
  incomeTaxExpense: number | null;
  interestExpenses: number | null;
  manageFee: number | null;
  salesFee: number | null;
  researchAndDevelopmentExpenses: number | null;
}

export interface BalanceSheet {
  symbol: Symbol;
  period: ReportPeriod;
  periodEndMs: number;
  reportDateMs: number;
  fiscalYear: number;
  fiscalPeriod: string;
  currency: string;
  totalCurrentAssets: number | null;
  nonCurrentNetsTotal: number | null;
  assetsTotal: number | null;
  totalDebt: number | null;
  holderEquityTotal: number | null;
  cash: number | null;
  accountsReceivable: number | null;
}

export interface CashFlowStatement {
  symbol: Symbol;
  period: ReportPeriod;
  periodEndMs: number;
  reportDateMs: number;
  fiscalYear: number;
  fiscalPeriod: string;
  currency: string;
  actCashFlowNet: number | null;
  investCashFlowNet: number | null;
  financingCashFlowNet: number | null;
  cashEquivalentsNetAddition: number | null;
  payDividendsProfitsInterestCash: number | null;
  payFixedAssetsEtcCash: number | null;
}

export type IndicatorCategory = 'growth' | 'profitability' | 'solvency' | 'operation' | 'cash-flow';

export interface FinancialIndicator {
  category: IndicatorCategory;
  indexId: string;
  /** 指标值（字符串，上游缺失为 null） */
  value: string | null;
}

// ============ 指数 / 板块 ============
export type IndexTag = 'cn_concept' | 'region' | 'tszs' | 'industry';

export interface IndexInfo {
  symbol: Symbol;
  name: string;
}

export interface IndexConstituent {
  symbol: Symbol;
  name: string;
}

// ============ 复权事件 ============
export interface AdjustmentFactor {
  symbol: Symbol;
  ticker: string;
  exDateMs: number;
  /** 每股现金分红（税前） */
  dividendPerShare: number;
  /** 每股送股比例 */
  perShareBonus: number;
}

// ============ 基金 ============
export type FundType = 'otc' | 'exchange' | 'reits';

export interface FundProfile {
  symbol: Symbol;
  ticker: string;
  fundName: string | null;
  estabDateMs: number | null;
  mgmtName: string | null;
  managerName: string | null;
}

export interface FundHolding {
  symbol: Symbol;
  ticker: string;
  stockName: string;
  /** 持仓占比（百分数原值，如 8.88 表示 8.88%） */
  holdRatio: number;
}

export interface FundNav {
  symbol: Symbol;
  navDate: string;
  unitNav: number | null;
  adjNav: number | null;
}

export interface FundReturn {
  symbol: Symbol;
  returnMonth: number | null;
  returnTmonth: number | null;
  returnHyar: number | null;
  returnYear: number | null;
  returnTyear: number | null;
  returnFyear: number | null;
  returnNowYear: number | null;
  returnNow: number | null;
}

export interface FundHolder {
  symbol: Symbol;
  mergeScope: 'merged' | 'separate';
  reportDateMs: number;
  insPosition: number | null;
  holderAmount: number | null;
  avgHolderShare: number | null;
  psnlRate: number | null;
  mgmtStaffHoldRate: number | null;
}

// ============ 特色数据 ============
export interface LimitUpStock {
  symbol: Symbol;
  name: string;
  isSt: boolean;
  isNew: boolean;
  lastPrice: number;
  changePct: number;
  limitUpTime: string;
  limitUpReason: string;
  continueDayText: string;
  continueDayCnt: number;
  sealMoney: number;
  maxSealMoney: number;
}

export interface HotStock {
  symbol: Symbol;
  name: string;
  rank: number;
  heat: number;
  rankChange: number;
  rankTrend: string;
}

export interface AnomalyStock {
  symbol: Symbol;
  stockName: string;
  analysisContent: string;
  keywordList: string[];
  tagName: string;
}

export interface DragonTigerStock {
  symbol: Symbol;
  name: string;
  conceptList: string[];
  change: number;
  buyValue: number;
  sellValue: number;
  netValue: number;
  netRate: number;
  orgNetValue: number;
  hotMoneyNetValue: number;
  hotRank: number;
  rangeDays: number;
  limitReason: string;
}

export interface DragonTigerHotMoney {
  name: string;
  buying: number;
  rows: Array<{
    symbol: Symbol;
    name: string;
    conceptList: string[];
    change: number;
    amount: number;
    buyValue: number;
    sellValue: number;
    netValue: number;
    netRate: number;
    orgNetValue: number;
    hotMoneyNetValue: number;
    hotMoneyNetRate: number;
    hotMoneyItemNetValue: number;
    hotMoneyItemNetRate: number;
    hotRank: number;
    rangeDays: number;
  }>;
}

export interface DragonTigerList {
  boardType: string;
  tradeDate: string;
  count: number;
  stockCount: number;
  stockItems: DragonTigerStock[];
  hotMoneyItems: DragonTigerHotMoney[];
}

export interface TradingDay {
  dateMs: number;
  date: string;
}

// ============ 查询参数 ============
export interface KlineParams {
  symbol: Symbol;
  period: KlinePeriod;
  /** 起始毫秒时间戳（含） */
  startMs?: number;
  /** 结束毫秒时间戳（含） */
  endMs?: number;
  /** 复权方式（仅 A 股个股有效） */
  adjust?: AdjustMode;
  /** 拉取数量（部分源使用） */
  count?: number;
}

export interface SearchParams {
  keyword: string;
  exchange?: 'SH' | 'SZ' | 'BJ';
  assetType?: AssetType;
  /** 返回条数上限 */
  limit?: number;
}

export interface HistoricalFinancialParams {
  symbol: Symbol;
  period: ReportPeriod;
  /** 最近 N 期（1–20） */
  limit?: number;
  /** 区间起始（毫秒），与 end 一起使用 */
  startMs?: number;
  /** 区间结束（毫秒），与 start 一起使用；start/end 与 limit 互斥 */
  endMs?: number;
}

export interface IndicatorsParams {
  symbol: Symbol;
  /** 报告期，格式 YYYY-[1-4]，例如 2024-4 */
  report: string;
}

export interface Pagination {
  total: number;
  pages: number;
  size: number;
  page: number;
}

/** 统一的列表结果包装 */
export interface ListResult<T> {
  items: T[];
  pagination?: Pagination;
}

// ============ stock-sdk 扩展结果类型（大而全，覆盖 stock-sdk 全量 api） ============

/** 行情快照入参（A股） */
export interface QuotesParams {
  symbols: Symbol[];
}

/** 美股行情入参 */
export interface UsQuotesParams {
  codes: string[];
}

/** 港股行情入参 */
export interface HkQuotesParams {
  codes: string[];
}

/** 指数K线入参 */
export interface IndexKlineParams {
  indexCode: string;
  period?: KlinePeriod;
  count?: number;
  [k: string]: unknown;
}

/** 搜索结果 */
export interface SearchResult {
  code: string;
  name: string;
  market?: string;
  [k: string]: unknown;
}

/** 个股档案 */
export interface StockInfo {
  code?: string;
  name?: string;
  industry?: string;
  [k: string]: unknown;
}

/** 财务报表（同花顺 getFinancials 返回） */
export interface FinancialReport {
  [k: string]: unknown;
}

/** 业绩预测（同花顺 getProfitForecast 返回） */
export interface ProfitForecast {
  [k: string]: unknown;
}

// —— 资讯 / 公告 ——

export interface NewsItem {
  title?: string;
  time?: string;
  url?: string;
  [k: string]: unknown;
}

export interface AnnouncementItem {
  title?: string;
  date?: string;
  [k: string]: unknown;
}

export interface BlockTradeItem {
  code?: string;
  name?: string;
  price?: number;
  volume?: number;
  amount?: number;
  [k: string]: unknown;
}

// —— 资金流 / 排行 ——

export interface MainForceItem {
  code?: string;
  date?: string;
  mainFlow?: number;
  [k: string]: unknown;
}

export interface HotItem {
  code?: string;
  name?: string;
  rank?: number;
  heat?: number;
  [k: string]: unknown;
}

// —— 股东 ——

export interface HolderItem {
  code?: string;
  name?: string;
  holdRatio?: number;
  [k: string]: unknown;
}

export interface LargestHolderItem {
  code?: string;
  name?: string;
  holdRatio?: number;
  [k: string]: unknown;
}

export interface HolderChangeItem {
  code?: string;
  date?: string;
  change?: number;
  [k: string]: unknown;
}

// —— 龙虎榜 ——

export interface TopListItem {
  code?: string;
  name?: string;
  reason?: string;
  [k: string]: unknown;
}

// —— 涨停 / 跌停 / 龙虎榜 ——

export interface LimitUpDownItem {
  code?: string;
  name?: string;
  price?: number;
  changePct?: number;
  reason?: string;
  [k: string]: unknown;
}

export interface DragonTigerItem {
  code?: string;
  name?: string;
  reason?: string;
  buyAmount?: number;
  sellAmount?: number;
  [k: string]: unknown;
}

// —— 分时 ——

export interface TimeSharingItem {
  time?: string | number;
  price?: number;
  avgPrice?: number;
  volume?: number;
  [k: string]: unknown;
}

export interface UsTimeSharingItem {
  time?: string | number;
  price?: number;
  avgPrice?: number;
  volume?: number;
  [k: string]: unknown;
}

export interface TimeSharingParams {
  code?: string;
  market?: string;
  [k: string]: unknown;
}

// —— 美股 / 港股 K线 ——

export interface UsKlineParams {
  code: string;
  period?: string;
  [k: string]: unknown;
}

export interface HkKlineParams {
  code: string;
  period?: string;
  [k: string]: unknown;
}

// —— A/H 溢价 / 新股 / 日历 / 资金流 ——

export interface AHPremiumItem {
  code?: string;
  name?: string;
  ahPremium?: number;
  [k: string]: unknown;
}

export interface StockNewStockItem {
  code?: string;
  name?: string;
  issuePrice?: number;
  listDate?: string;
  [k: string]: unknown;
}

export interface StockAHItem {
  code?: string;
  name?: string;
  aCode?: string;
  hCode?: string;
  [k: string]: unknown;
}

export interface TradingCalendarItem {
  date?: string;
  trading?: boolean;
  [k: string]: unknown;
}

export interface FundsFlowingItem {
  code?: string;
  name?: string;
  mainFlow?: number;
  [k: string]: unknown;
}

export interface HotIndustryItem {
  name?: string;
  changePct?: number;
  [k: string]: unknown;
}

export interface TodaySurgeItem {
  code?: string;
  name?: string;
  changePct?: number;
  [k: string]: unknown;
}

export interface IndustryBoardItem {
  name?: string;
  code?: string;
  changePct?: number;
  [k: string]: unknown;
}

export interface IndustryFundsFlowingItem {
  name?: string;
  mainFlow?: number;
  [k: string]: unknown;
}

export interface LimitUpPoolItem {
  code?: string;
  name?: string;
  changePct?: number;
  [k: string]: unknown;
}

// ============ fund-api 基金全系结果类型 =========

export interface FundListItem {
  code?: string;
  name?: string;
  type?: string;
  [k: string]: unknown;
}

export interface FundInfo {
  code?: string;
  name?: string;
  type?: string;
  netValue?: number;
  [k: string]: unknown;
}

export interface FundHistoryItem {
  date?: string;
  netValue?: number;
  accNetValue?: number;
  [k: string]: unknown;
}

export interface FundRankItem {
  code?: string;
  name?: string;
  returnRate?: number;
  [k: string]: unknown;
}

export interface FundValuation {
  code?: string;
  name?: string;
  estimateValue?: number;
  [k: string]: unknown;
}

export interface FundBonusItem {
  code?: string;
  exDate?: string;
  bonus?: number;
  [k: string]: unknown;
}

export interface FundAssetItem {
  code?: string;
  name?: string;
  ratio?: number;
  [k: string]: unknown;
}

export interface FundManagerItem {
  code?: string;
  name?: string;
  manager?: string;
  [k: string]: unknown;
}

export interface FundNewFundItem {
  code?: string;
  name?: string;
  issueDate?: string;
  [k: string]: unknown;
}

export interface FundReitsItem {
  code?: string;
  name?: string;
  [k: string]: unknown;
}

export interface FundTradeItem {
  code?: string;
  name?: string;
  [k: string]: unknown;
}

export interface FundStockItem {
  code?: string;
  name?: string;
  ratio?: number;
  [k: string]: unknown;
}

export interface FundFinancingItem {
  code?: string;
  name?: string;
  [k: string]: unknown;
}

export interface FundPerformanceItem {
  code?: string;
  name?: string;
  [k: string]: unknown;
}

export interface FundReferenceItem {
  code?: string;
  name?: string;
  [k: string]: unknown;
}

export interface FundThemeItem {
  theme?: string;
  code?: string;
  name?: string;
  [k: string]: unknown;
}

export interface FundShareItem {
  code?: string;
  date?: string;
  share?: number;
  [k: string]: unknown;
}

export interface FundTopicItem {
  topic?: string;
  code?: string;
  name?: string;
  [k: string]: unknown;
}

export interface FundCategory {
  code?: string;
  name?: string;
  [k: string]: unknown;
}
