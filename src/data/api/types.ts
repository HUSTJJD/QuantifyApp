/**
 * 行情数据领域统一类型定义
 *
 * 设计原则：
 *  - 所有数据源都把外部结构归一化到这里；
 *  - 上层（feature / ui）完全不感知具体数据源差异；
 *  - 时间统一用毫秒时间戳（number）或 ISO 字符串；
 *  - 可空字段保持 null，绝不补零。
 */

// ============================================================
// 基础类型
// ============================================================

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

/** 统一标的标识（thscode 风格，如 600519.SH / 00700.HK） */
export interface Symbol {
  code: string;
  exchange: Exchange;
  name?: string;
}

/** K 线周期 */
export type KlinePeriod = 'day' | 'week' | 'month' | '1m' | '5m' | '15m' | '30m' | '60m';

/** 复权方式 */
export type AdjustMode = 'none' | 'forward' | 'backward';

/** 基础标的信息 */
export interface Instrument {
  symbol: Symbol;
  name: string;
  market: Market;
  assetType?: AssetType;
  currency?: string;
}

// ============================================================
// 行情
// ============================================================

/** 单根 K 线 */
export interface Candle {
  datetime: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount?: number;
}

/** 实时行情快照 */
export interface Quote {
  symbol: Symbol;
  last: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  changePct?: number;
  change?: number;
  amplitudePct?: number;
  updatedAt?: number;
}

/** 五档盘口 */
export interface OrderBook {
  symbol: Symbol;
  bids: Array<{ price: number; volume: number }>;
  asks: Array<{ price: number; volume: number }>;
  updatedAt: number;
}

/** 复权事件 */
export interface AdjustmentFactor {
  symbol: Symbol;
  ticker: string;
  exDateMs: number;
  dividendPerShare: number | null;
  perShareBonus: number | null;
  allotmentRatio?: number | null;
  allotmentPrice?: number | null;
}

// ============================================================
// 估值
// ============================================================

export interface Valuation {
  symbol: Symbol;
  name?: string | null;
  peTtm: number | null;
  peMrq: number | null;
  pbMrq: number | null;
  psTtm: number | null;
  pcfTtm: number | null;
  timestamp?: number | null;
}

// ============================================================
// 财务报表
// ============================================================

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
  value: string | null;
}

/** 财务汇总报表（三大报表按报告期合并；字段已归一化，不再透传源原始结构） */
export interface FinancialReport {
  symbol?: Symbol;
  period?: ReportPeriod;
  periodEndMs?: number;
  basicEps?: number | null;
  operatingIncome?: number | null;
  operatingCosts?: number | null;
  netProfit?: number | null;
  parentHolderNetProfit?: number | null;
  totalAssets?: number | null;
  holderEquityTotal?: number | null;
  operatingCashFlow?: number | null;
}

/** 业绩预测（当前三源均无端点；字段按同花顺盈利预测常见口径预留） */
export interface ProfitForecast {
  symbol?: Symbol;
  /** 预测报告期，如 2024-12-31 */
  reportDate?: string;
  /** 机构家数 */
  orgCount?: number | null;
  /** 预测净利润均值（元） */
  netProfitAvg?: number | null;
  /** 预测净利润最大/最小 */
  netProfitMax?: number | null;
  netProfitMin?: number | null;
  /** 预测 EPS 均值 */
  epsAvg?: number | null;
  /** 预测 PE */
  peAvg?: number | null;
}

// ============================================================
// 指数 / 板块
// ============================================================

export type IndexTag = 'cn_concept' | 'region' | 'tszs' | 'industry';

export interface IndexInfo {
  symbol: Symbol;
  name: string;
}

export interface IndexConstituent {
  symbol: Symbol;
  name: string;
}

// ============================================================
// 基金
// ============================================================

export type FundType = 'otc' | 'exchange' | 'reits';

/** 基金净值区间（对齐 fuyao NavRange） */
export type FundNavRange = 'week' | 'month' | 'tmonth' | 'hyear' | 'year' | 'twoyear' | 'tyear' | 'fyear';

/** 基金净值类型（对齐 fuyao navType；unit,adj 为默认全量） */
export type FundNavType = 'unit' | 'adj' | 'unit,adj';

/** 基金持有人合并范围（对齐 fuyao mergeScope） */
export type FundMergeScope = 'all' | 'merged' | 'separate';

/**
 * 财务指标报告期：格式 `yyyy-1|yyyy-2|yyyy-3|yyyy-4`
 * （1=一季报、2=中报、3=三季报、4=年报），如 `2024-4`。
 */
export type FinancialReportPeriod = `${number}-1` | `${number}-2` | `${number}-3` | `${number}-4`;

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

/** 连板天梯板位键（对齐 fuyao LadderBoardKey） */
export type LadderBoardKey = 'two_board' | 'three_board' | 'four_board' | 'five_board' | 'six_board' | 'seven_over';

/** 连板天梯单只股票 */
export interface LadderStock {
  symbol: Symbol;
  name: string;
  boardNum: number;
  /** 次一交易日是否继续封板；最近交易日为 null */
  sealNextDay: boolean | null;
  signLevel: number;
}

/** 连板天梯单日矩阵 */
export interface LadderDay {
  /** 交易日期 yyyyMMdd */
  date: string;
  boards: Record<LadderBoardKey, LadderStock[]>;
}

/** 连板天梯：近 N 个交易日 × 板位矩阵 */
export interface LimitUpLadder {
  timestamp: number;
  window: {
    length: number;
    dateList: string[];
    boardCaps: Partial<Record<LadderBoardKey, number>>;
  };
  days: LadderDay[];
}

// ============================================================
// 特色数据
// ============================================================

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

// ============================================================
// 交易日历
// ============================================================

export interface TradingDay {
  dateMs: number;
  date: string;
}

// ============================================================
// 查询参数
// ============================================================

export interface KlineParams {
  symbol: Symbol;
  period: KlinePeriod;
  startMs?: number;
  endMs?: number;
  adjust?: AdjustMode;
  count?: number;
}

export interface SearchParams {
  keyword: string;
  exchange?: 'SH' | 'SZ' | 'BJ';
  assetType?: AssetType;
  limit?: number;
}

export interface HistoricalFinancialParams {
  symbol: Symbol;
  period: ReportPeriod;
  limit?: number;
  startMs?: number;
  endMs?: number;
}

export interface IndicatorsParams {
  symbol: Symbol;
  /** 报告期，格式 yyyy-1|yyyy-2|yyyy-3|yyyy-4（如 2024-4） */
  report: FinancialReportPeriod;
}

/** 当日分时入参（统一入口，替代原 getStockTimeSharing / getTimeSharing 等市场别名） */
export interface IntradayParams {
  symbol: Symbol;
  /** 交易日 YYYY-MM-DD；缺省为最近交易日（当前实现仅支持当日） */
  date?: string;
}

/** 统一分时点 */
export interface IntradayPoint {
  /** HH:mm（本地市场时区）或毫秒时间戳 */
  time: string | number;
  price: number;
  avgPrice?: number | null;
  /** 累计成交量 */
  volume?: number | null;
  /** 累计成交额 */
  amount?: number | null;
}

export interface Pagination {
  total: number;
  pages: number;
  size: number;
  page: number;
}

export interface ListResult<T> {
  items: T[];
  pagination?: Pagination;
}

// ============================================================
// 扩展类型（stock-sdk 等源提供的额外能力）
// ============================================================

/** 个股档案 */
export interface StockInfo {
  code?: string;
  name?: string;
  industry?: string;
  [k: string]: unknown;
}

/** 资讯 / 公告 */
export type NewsMarket = 'A' | 'HK' | 'US' | 'all';
export type NewsKind = 'news' | 'announcement' | 'finance';

/** 资讯条目（跨源共有字段强类型） */
export interface NewsItem {
  title: string;
  /** 摘要 / 正文首段 */
  summary?: string | null;
  /** 发布时间 ISO 或源格式 */
  publishTime?: string | null;
  url?: string | null;
  source?: string | null;
  /** 相关标的（可选） */
  symbols?: Symbol[];
}

export interface AnnouncementItem {
  title: string;
  publishDate?: string | null;
  url?: string | null;
  symbol?: Symbol;
}

/** 资讯查询入参 */
export interface NewsParams {
  market?: NewsMarket;
  kind?: NewsKind;
  symbol?: Symbol;
  limit?: number;
}

/** 公告查询入参 */
export interface AnnouncementParams {
  symbol?: Symbol;
  limit?: number;
}

/** 大宗交易 */
export interface BlockTradeItem {
  symbol?: Symbol;
  name?: string;
  price?: number | null;
  volume?: number | null;
  amount?: number | null;
  date?: string;
}

/** 个股主力资金历史点（stock-sdk fundFlow.individual） */
export interface MainForceItem {
  date: string;
  close?: number | null;
  changePct?: number | null;
  mainNetInflow: number | null;
  mainNetInflowPct?: number | null;
  superLargeNetInflow?: number | null;
  largeNetInflow?: number | null;
  mediumNetInflow?: number | null;
  smallNetInflow?: number | null;
}

/** 个股资金流排行项（stock-sdk fundFlow.rank） */
export interface FundsFlowingItem {
  symbol: Symbol;
  name: string;
  price?: number | null;
  changePct?: number | null;
  mainNetInflow: number | null;
  mainNetInflowPct?: number | null;
}

export type FundFlowPeriod = 'today' | '3day' | '5day' | '10day';

export interface FundsFlowingParams {
  period?: FundFlowPeriod;
  limit?: number;
}

/** 板块资金流排行（stock-sdk fundFlow.sectorRank） */
export interface IndustryFundsFlowingItem {
  code: string;
  name: string;
  changePct?: number | null;
  mainNetInflow: number | null;
  mainNetInflowPct?: number | null;
  topStockName?: string | null;
  topStockCode?: string | null;
}

export interface IndustryFundsFlowingParams {
  period?: FundFlowPeriod;
  sectorType?: 'industry' | 'concept' | 'region';
  limit?: number;
}

/** 热门行业（与板块资金流同构，按热度排序） */
export interface HotIndustryItem {
  code: string;
  name: string;
  changePct?: number | null;
  mainNetInflow?: number | null;
}

/** 行业板块行情（强类型；无成交额时 amount 用 totalMarketCap 代理） */
export interface IndustryBoardItem {
  code: string;
  name: string;
  rank?: number;
  price?: number | null;
  change?: number | null;
  changePct?: number | null;
  /** 板块无成交额字段时为总市值代理 */
  amount?: number | null;
  totalMarketCap?: number | null;
  turnoverRate?: number | null;
  riseCount?: number | null;
  fallCount?: number | null;
  leadingStock?: string | null;
}

export interface IndustryBoardParams {
  limit?: number;
}

/** 今日异动/飙升（stock-sdk marketEvent.stockChanges） */
export interface TodaySurgeItem {
  symbol: Symbol;
  name: string;
  /** 异动类型标签，如 火箭发射 / 快速反弹 */
  changeType?: string | null;
  info?: string | null;
  price?: number | null;
  changePct?: number | null;
}

/** 股东（跨源共有字段） */
export interface HolderItem {
  symbol: Symbol;
  name: string;
  /** 持股数（股） */
  holdShares?: number | null;
  /** 持股占流通股比（%） */
  holdRatioFloat?: number | null;
  /** 持股占总股本比（%） */
  holdRatioTotal?: number | null;
  /** 持股市值（元） */
  holdMarketValue?: number | null;
  /** 报告期 YYYY-MM-DD */
  reportDate?: string | null;
}

export type LargestHolderItem = HolderItem;

export interface HolderChangeItem {
  symbol: Symbol;
  holderName: string;
  /** 变动股数（正=增持，负=减持） */
  changeShares?: number | null;
  changeRatio?: number | null;
  date?: string | null;
  reason?: string | null;
}

export interface HolderParams {
  symbol: Symbol;
  /** 报告期可选过滤 */
  reportDate?: string;
  limit?: number;
}

/** 榜单（龙虎榜席位等） */
export interface TopListItem {
  symbol?: Symbol;
  name?: string;
  reason?: string | null;
  buyAmount?: number | null;
  sellAmount?: number | null;
}

/** 跌停/炸板池（对齐 fuyao LimitDownPoolItem / LimitBreakPoolItem） */
export interface LimitDownStock {
  symbol: Symbol;
  name: string;
  lastPrice: number;
  changePct: number;
  firstLimitTime?: string;
  lastLimitTime?: string;
  turnoverRatioPct?: number | null;
}

export interface LimitBreakStock {
  symbol: Symbol;
  name: string;
  lastPrice: number;
  changePct: number;
  openTimes?: number | null;
  turnoverRatioPct?: number | null;
  turnover?: number | null;
}

/** A/H 溢价 / 新股 */
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

/** 交易日历（stock-sdk 格式） */
export interface TradingCalendarItem {
  date?: string;
  trading?: boolean;
  [k: string]: unknown;
}

/** 热股 */
export interface HotItem {
  code?: string;
  name?: string;
  rank?: number;
  heat?: number;
  [k: string]: unknown;
}

// ============================================================
// 基金扩展类型（fund-api / stock-sdk 基金能力）
// ============================================================

export interface FundListItem {
  code?: string;
  name?: string;
  type?: string;
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

// ============================================================
// P0-B 能力缺口：期权 / 期货 / 北向 / 筹码 / 两融 / 概念板块
// ============================================================

// ---------- 期权 ----------

/** 中金所股指期权产品：上证50 / 沪深300 / 中证1000 */
export type IndexOptionProduct = 'ho' | 'io' | 'mo';

/** ETF 期权品种（上交所） */
export type EtfOptionCate = '50ETF' | '300ETF' | '500ETF' | '科创50' | '科创板50';

/** 期权 T 型报价腿 */
export interface OptionTQuoteLeg {
  symbol: string;
  buyVolume: number | null;
  buyPrice: number | null;
  price: number | null;
  askPrice: number | null;
  askVolume: number | null;
  openInterest: number | null;
  change: number | null;
  strikePrice: number | null;
}

/** 期权 T 型报价结果（认购 + 认沽） */
export interface OptionTQuoteResult {
  calls: OptionTQuoteLeg[];
  puts: OptionTQuoteLeg[];
}

/** 期权日 K */
export interface OptionKlineBar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

/** 中金所期权实时行情 */
export interface CffexOptionQuote {
  code: string;
  name: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  amount: number | null;
  openInterest: number | null;
  strikePrice: number | null;
  remainDays: number | null;
  prevSettle: number | null;
  open: number | null;
}

/** 期权龙虎榜项 */
export interface OptionLhbItem {
  tradeType: string;
  date: string;
  symbol: string;
  targetName: string;
  rank: number;
  memberName: string;
  buyVolume: number | null;
  sellVolume: number | null;
  netBuyVolume: number | null;
  buyVolumeRatio: number | null;
  sellVolumeRatio: number | null;
}

/** 期权 T 型报价入参（index=commodity；etf 无 T 型报价端点） */
export interface OptionQuoteParams {
  kind: 'index' | 'commodity';
  /** kind=index: ho|io|mo；kind=commodity: 品种代码如 SR/CF */
  product: string;
  /** 合约月份，如 2409 */
  contract: string;
}

/** 期权 K 线入参 */
export interface OptionKlineParams {
  kind: 'index' | 'commodity' | 'etf';
  /** index/commodity: 合约代码；etf: 期权代码 */
  code: string;
}

// ---------- 期货 ----------

/** 期货 K 线（含持仓量等期货专属字段） */
export interface FuturesKlineBar {
  date: string;
  code: string;
  name: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  amount: number | null;
  changePct: number | null;
  change: number | null;
  openInterest: number | null;
}

/** 全球期货实时报价 */
export interface GlobalFuturesQuote {
  code: string;
  name: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevSettle: number | null;
  volume: number | null;
  openInterest: number | null;
}

/** 期货库存品种 */
export interface FuturesInventorySymbol {
  code: string;
  name: string;
  marketCode: string;
}

/** 期货库存点 */
export interface FuturesInventoryPoint {
  code: string;
  date: string;
  inventory: number | null;
  change: number | null;
}

/** COMEX 库存点 */
export interface ComexInventoryPoint {
  date: string;
  name: string;
  storageTon: number | null;
  storageOunce: number | null;
}

export interface FuturesKlineParams {
  /** 合约代码，如 RB2410 / rb2410 */
  code: string;
  period?: 'daily' | 'weekly' | 'monthly';
  startMs?: number;
  endMs?: number;
}

export interface FuturesInventoryParams {
  code: string;
  startMs?: number;
  endMs?: number;
}

// ---------- 北向资金 ----------

export type NorthboundDirection = 'north' | 'south';
export type NorthboundMarket = 'all' | 'shanghai' | 'shenzhen';
export type NorthboundRankPeriod = 'today' | '3day' | '5day' | '10day' | 'month' | 'quarter' | 'year';

export interface NorthboundMinutePoint {
  date: string;
  time: string;
  shanghaiNetInflow: number | null;
  shenzhenNetInflow: number | null;
  totalNetInflow: number | null;
}

export interface NorthboundFlowSummaryItem {
  date: string;
  boardName: string;
  direction: string;
  status: string;
  netBuyAmount: number | null;
  netInflow: number | null;
  remainAmount: number | null;
  upCount: number | null;
  downCount: number | null;
  flatCount: number | null;
  indexCode: string;
  indexName: string;
  indexChangePct: number | null;
}

export interface NorthboundHoldingItem {
  date: string;
  symbol: Symbol;
  name: string;
  close: number | null;
  changePct: number | null;
  holdShares: number | null;
  holdMarketValue: number | null;
  holdRatioFloat: number | null;
  holdRatioTotal: number | null;
  addShares: number | null;
  addMarketValue: number | null;
  sector: string;
}

export interface NorthboundHistoryPoint {
  date: string;
  netBuyAmount: number | null;
  buyAmount: number | null;
  sellAmount: number | null;
  accNetBuyAmount: number | null;
  netInflow: number | null;
  remainAmount: number | null;
  topStockCode: string | null;
  topStockName: string | null;
  topStockChangePct: number | null;
}

export interface NorthboundIndividualPoint {
  date: string;
  holdShares: number | null;
  holdMarketValue: number | null;
  holdRatioFloat: number | null;
  holdRatioTotal: number | null;
  close: number | null;
  changePct: number | null;
}

export interface NorthboundHoldingRankParams {
  market?: NorthboundMarket;
  period?: NorthboundRankPeriod;
  date?: string;
}

export interface NorthboundHistoryParams {
  direction?: NorthboundDirection;
  startMs?: number;
  endMs?: number;
}

export interface NorthboundIndividualParams {
  symbol: Symbol;
  startMs?: number;
  endMs?: number;
}

// ---------- 筹码分布 ----------

/** 单日筹码峰直方图桶 */
export interface ChipHistogramBucket {
  price: number;
  ratio: number;
}

export interface ChipDistributionPoint {
  date: string;
  /** 获利比例 0..1 */
  profitRatio: number | null;
  /** 平均成本（中位数成本） */
  avgCost: number | null;
  cost90Low: number | null;
  cost90High: number | null;
  concentration90: number | null;
  cost70Low: number | null;
  cost70High: number | null;
  concentration70: number | null;
  histogram?: ChipHistogramBucket[];
}

export interface ChipDistributionParams {
  symbol: Symbol;
  /** 累计窗口交易日数，默认 120（东财口径）；0 = 全量 */
  range?: number;
  includeHistogram?: boolean;
  decimals?: number;
}

// ---------- 融资融券 ----------

export interface MarginAccountStat {
  date: string;
  finBalance: number | null;
  loanBalance: number | null;
  finBuyAmount: number | null;
  loanSellAmount: number | null;
  investorCount: number | null;
  liabilityInvestorCount: number | null;
  totalGuarantee: number | null;
  avgGuaranteeRatio: number | null;
}

export interface MarginTargetStat {
  symbol: Symbol;
  name: string;
  date: string;
  finBalance: number | null;
  finBuyAmount: number | null;
  finRepayAmount: number | null;
  loanBalance: number | null;
  loanSellVolume: number | null;
  loanRepayVolume: number | null;
}

// ---------- 概念板块 ----------

/** 概念板块行情（与行业板块 IndustryBoard 同构） */
export interface ConceptBoardItem {
  code: string;
  name: string;
  rank?: number;
  price?: number | null;
  change?: number | null;
  changePct?: number | null;
  totalMarketCap?: number | null;
  turnoverRate?: number | null;
  riseCount?: number | null;
  fallCount?: number | null;
  leadingStock?: string | null;
  leadingStockChangePct?: number | null;
}

export interface ConceptBoardParams {
  limit?: number;
}

export interface ConceptBoardConstituentItem {
  symbol: Symbol;
  name: string;
  rank?: number;
  price?: number | null;
  changePct?: number | null;
  volume?: number | null;
  amount?: number | null;
}

export interface ConceptBoardKlineParams {
  symbol: Symbol;
  period?: 'daily' | 'weekly' | 'monthly';
  adjust?: '' | 'qfq' | 'hfq';
  startMs?: number;
  endMs?: number;
}

// ============================================================
// P1-B 多源汇总：行业板块细分 / 龙虎榜细分 / 大宗统计 / 日历状态 / 分红
// ============================================================

/** 行业板块成分股（与概念成分同构，字段更全） */
export interface IndustryBoardConstituentItem {
  symbol: Symbol;
  name: string;
  rank?: number;
  price?: number | null;
  changePct?: number | null;
  change?: number | null;
  volume?: number | null;
  amount?: number | null;
  turnoverRate?: number | null;
  pe?: number | null;
  pb?: number | null;
}

export interface IndustryBoardKlineParams {
  symbol: Symbol;
  period?: 'daily' | 'weekly' | 'monthly';
  adjust?: '' | 'qfq' | 'hfq';
  startMs?: number;
  endMs?: number;
}

/** 板块资金流历史点（fundFlow.sectorHistory，结构同个股资金流） */
export type SectorFundFlowPoint = MainForceItem;

export interface SectorFundFlowHistoryParams {
  /** 板块代码，如 BK0438 */
  symbol: Symbol;
  period?: 'daily' | 'weekly' | 'monthly';
}

// ---------- 龙虎榜细分 ----------

export type DragonTigerPeriod = '1month' | '3month' | '6month' | '1year';

export interface DragonTigerInstitutionStat {
  symbol: Symbol;
  name: string;
  date: string;
  close?: number | null;
  changePct?: number | null;
  buyOrgCount?: number | null;
  sellOrgCount?: number | null;
  orgBuyAmount?: number | null;
  orgSellAmount?: number | null;
  orgNetAmount?: number | null;
}

export interface DragonTigerBranchStat {
  /** 营业部代码 */
  code: string;
  name: string;
  totalBuyAmount?: number | null;
  totalSellAmount?: number | null;
  buyCount?: number | null;
  sellCount?: number | null;
  totalCount?: number | null;
}

export interface DragonTigerSeat {
  rank?: number | null;
  branchName: string;
  buyAmount?: number | null;
  buyAmountRatio?: number | null;
  sellAmount?: number | null;
  sellAmountRatio?: number | null;
  netAmount?: number | null;
  side: 'buy' | 'sell';
}

export interface DragonTigerInstitutionParams {
  /** YYYY-MM-DD */
  startDate: string;
  endDate: string;
}

export interface DragonTigerSeatParams {
  symbol: Symbol;
  /** YYYY-MM-DD */
  date: string;
}

// ---------- 大宗交易统计 ----------

export interface BlockTradeMarketStat {
  date: string;
  shClose?: number | null;
  shChangePct?: number | null;
  totalAmount?: number | null;
  premiumAmount?: number | null;
  premiumRatio?: number | null;
  discountAmount?: number | null;
  discountRatio?: number | null;
}

export interface BlockTradeDailyStat {
  symbol: Symbol;
  name: string;
  date: string;
  changePct?: number | null;
  close?: number | null;
  dealCount?: number | null;
  dealTotalAmount?: number | null;
  dealTotalVolume?: number | null;
  premiumAmount?: number | null;
  discountAmount?: number | null;
}

export interface BlockTradeDateParams {
  startDate?: string;
  endDate?: string;
}

// ---------- 交易日状态 ----------

export type MarketSessionStatus = 'pre_market' | 'open' | 'lunch_break' | 'after_hours' | 'closed';

// ---------- 分红明细 ----------

export interface DividendDetailItem {
  symbol: Symbol;
  name: string;
  reportDate?: string | null;
  planNoticeDate?: string | null;
  /** 每股税前派息（元） */
  dividendPretax?: number | null;
  /** 股息率（%） */
  dividendYield?: number | null;
  /** 每股送转 */
  bonusRatio?: number | null;
  transferRatio?: number | null;
  exDividendDate?: string | null;
  equityRecordDate?: string | null;
  payDate?: string | null;
  assignProgress?: string | null;
}

// ============================================================
// P2 闭环补录：大盘资金流 / ETF 期权细节 / 指标 / 异动 / 龙虎榜统计 / 基金扩展 / 竞价
// ============================================================

/** 大盘资金流（按日） */
export interface MarketFundFlowPoint {
  date: string;
  shClose?: number | null;
  shChangePct?: number | null;
  szClose?: number | null;
  szChangePct?: number | null;
  mainNetInflow?: number | null;
  mainNetInflowPct?: number | null;
  superLargeNetInflow?: number | null;
  largeNetInflow?: number | null;
  mediumNetInflow?: number | null;
  smallNetInflow?: number | null;
}

/** ETF 期权各月合约信息 */
export interface EtfOptionMonths {
  months: string[];
  stockId: string;
  cateId: string;
  cateList: string[];
}

/** ETF 期权某到期日合约 */
export interface EtfOptionExpireDay {
  expireDay: string;
  remainderDays: number;
  stockId: string;
  name: string;
}

/** 期权分钟点 */
export interface OptionMinutePoint {
  time: string;
  date: string;
  price: number | null;
  volume: number | null;
  openInterest: number | null;
  avgPrice: number | null;
}

/** 盘口大单占比（单标的） */
export interface LargeOrderRatio {
  symbol: Symbol;
  buyLargeRatio: number | null;
  buySmallRatio: number | null;
  sellLargeRatio: number | null;
  sellSmallRatio: number | null;
}

/** 盘口异动事件（全市场） */
export type StockChangeType =
  | 'rocket_launch' | 'quick_rebound' | 'large_buy' | 'limit_up_seal' | 'limit_down_open'
  | 'big_buy_order' | 'auction_up' | 'high_open_5d' | 'gap_up' | 'high_60d' | 'surge_60d'
  | 'accelerate_down' | 'high_dive' | 'large_sell' | 'limit_down_seal' | 'limit_up_open'
  | 'big_sell_order' | 'auction_down' | 'low_open_5d' | 'gap_down' | 'low_60d' | 'drop_60d'
  | 'all' | 'unknown';

export interface StockChangeEvent {
  time: string;
  symbol: Symbol;
  name: string;
  changeType: StockChangeType;
  changeTypeLabel: string;
  info: string;
}

export interface IndividualStockChangeEvent {
  time: string;
  changeType: StockChangeType;
  changeTypeLabel: string;
  price: number | null;
  changePct: number | null;
  info: string;
}

export interface IndividualChangeParams {
  symbol: Symbol;
  /** YYYY-MM-DD */
  date?: string;
}

/** 龙虎榜个股上榜统计 */
export interface DragonTigerStockStat {
  symbol: Symbol;
  name: string;
  latestDate: string;
  close?: number | null;
  changePct?: number | null;
  count?: number | null;
  totalBuyAmount?: number | null;
  totalSellAmount?: number | null;
  totalNetAmount?: number | null;
  afterChange1d?: number | null;
  afterChange5d?: number | null;
  afterChange10d?: number | null;
}

/** 基金分红记录 */
export interface FundDividendRecord {
  code: string;
  name: string;
  equityRecordDate?: string | null;
  exDividendDate?: string | null;
  dividendPerShare?: number | null;
  payDate?: string | null;
  dividendType?: string | null;
}

export interface FundDividendListParams {
  year?: number | string;
  page?: number | 'all';
  fundType?: string;
  code?: string;
}

/** 基金同类排名走势点 */
export interface FundRankHistoryPoint {
  date: string;
  rank: number | null;
  total: number | null;
  percentile: number | null;
}

export interface FundRankHistoryResult {
  code: string;
  name: string | null;
  items: FundRankHistoryPoint[];
}

/** 集合竞价快照（fuyao） */
export interface AuctionSnapshot {
  symbol: Symbol;
  name: string;
  auctionPrice: number | null;
  auctionPct: number | null;
  auctionVolume: number | null;
  auctionAmount: number | null;
  auctionUnmatched: number | null;
  auctionTurnoverPct: number | null;
  preClosePrice: number | null;
  openPrice: number | null;
  lastPrice: number | null;
  floatMarketCap: number | null;
}

export interface AuctionSnapshotParams {
  symbols: Symbol[];
  stage?: 'live' | 'final';
}

/** 短线风向标（fuyao） */
export interface ShortTermBenchmark {
  symbol: Symbol;
  name: string;
  auctionPct: number | null;
  tags: string[];
}

// ============================================================
// 入参包装类型
// ============================================================

/** 行情快照入参 */
export interface QuotesParams {
  symbols: Symbol[];
}

/** 指数K线入参 */
export interface IndexKlineParams {
  indexCode: string;
  period?: KlinePeriod;
  count?: number;
  [k: string]: unknown;
}

/** 搜索结果（兼容旧格式） */
export interface SearchResult {
  code: string;
  name: string;
  market?: string;
  [k: string]: unknown;
}
