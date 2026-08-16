/**
 * 数据源统一抽象接口（端口 / Port）。
 *
 * 这是整个 API 层的核心契约：上层只依赖这个接口，不关心底层是同花顺官方 REST
 * 还是 stock-api。任意新的数据源只要实现本接口，即可通过 MarketDataClient 无缝切换。
 *
 * 能力范围（基于同花顺官方 REST 契约 + stock-api 兜底）：
 *  - 行情：实时快照、历史日 K、复权事件、五档盘口
 *  - 元信息：标的检索、代码表
 *  - 财务：利润表 / 资产负债表 / 现金流量表 / 财务指标
 *  - 估值：五项估值快照
 *  - 指数/板块：目录、成分股、行情、历史 K
 *  - 基金：资料 / 持仓 / 净值 / 收益 / 持有人 / 场内行情 / ETF 历史
 *  - 特色数据：涨停池 / 连板天梯 / 异动 / 飙升榜 / 热股榜 / 龙虎榜
 *  - 交易日历
 *
 * 设计要点：
 *  - 所有方法返回 Promise，统一异步契约；
 *  - 跨数据源差异（代码后缀、字段命名、周期枚举）都在具体实现里消化；
 *  - 方法失败统一抛出 DataSourceError，便于上层做错误分类与重试；
 *  - 不支持的能力（如某源不支持港股）应抛出带明确 code 的 DataSourceError，
 *    由 MarketDataClient 决定是否降级到其它源。
 */
import type {
  AdjustmentFactor,
  AnomalyStock,
  Candle,
  DragonTigerList,
  FundHolder,
  FundHolding,
  FundNav,
  FundProfile,
  FundReturn,
  FundType,
  HotStock,
  IndexConstituent,
  IndexInfo,
  IndexTag,
  Instrument,
  KlineParams,
  LimitUpStock,
  ListResult,
  OrderBook,
  Quote,
  SearchParams,
  Symbol,
  TradingDay,
  Valuation,
  IncomeStatement,
  BalanceSheet,
  CashFlowStatement,
  HistoricalFinancialParams,
  IndicatorsParams,
  FinancialIndicator,
} from './types';

export interface MarketDataSource {
  /** 数据源唯一标识，例如 'hithsa' | 'stock-api' */
  readonly id: string;
  /** 数据源可读名称，用于 UI 展示 */
  readonly label: string;

  /** 初始化（建立连接 / 预热缓存等），可重复调用 */
  init(): Promise<void>;
  /** 释放资源 */
  dispose(): Promise<void>;

  // ---------- 元信息 ----------
  /** 标的检索与消歧 */
  search(params: SearchParams): Promise<Instrument[]>;
  /** 批量代码表（按交易所 / 资产类别） */
  listTickers(opts?: {
    exchange?: string;
    assetType?: string;
    limit?: number;
    offset?: number;
  }): Promise<Instrument[]>;

  // ---------- 行情 ----------
  /** 批量实时行情快照 */
  getQuotes(symbols: Symbol[]): Promise<Quote[]>;
  /** 单标的五档盘口（不支持的源抛错） */
  getOrderBook(symbol: Symbol): Promise<OrderBook>;
  /** 历史 K 线 */
  getKline(params: KlineParams): Promise<Candle[]>;
  /** 复权事件流 */
  getAdjustmentFactors(symbol: Symbol, from?: string, to?: string): Promise<AdjustmentFactor[]>;

  // ---------- 估值 ----------
  getValuations(symbols: Symbol[]): Promise<Valuation[]>;

  // ---------- 财务 ----------
  getIncomeStatements(params: HistoricalFinancialParams): Promise<IncomeStatement[]>;
  getBalanceSheets(params: HistoricalFinancialParams): Promise<BalanceSheet[]>;
  getCashFlowStatements(params: HistoricalFinancialParams): Promise<CashFlowStatement[]>;
  getFinancialIndicators(params: IndicatorsParams): Promise<FinancialIndicator[]>;

  // ---------- 指数 / 板块 ----------
  listIndices(tag?: IndexTag): Promise<IndexInfo[]>;
  getIndexConstituents(symbol: Symbol): Promise<IndexConstituent[]>;
  getIndexQuotes(symbols: Symbol[]): Promise<Quote[]>;
  getIndexKline(params: KlineParams): Promise<Candle[]>;

  // ---------- 基金 ----------
  getFundProfile(symbol: Symbol, fundType: FundType): Promise<FundProfile>;
  getFundHoldings(symbol: Symbol, fundType: FundType): Promise<FundHolding[]>;
  getFundNav(symbol: Symbol, fundType: FundType, range?: string, navType?: string): Promise<FundNav[]>;
  getFundReturns(symbol: Symbol, fundType: FundType): Promise<FundReturn>;
  getFundHolders(symbol: Symbol, fundType: FundType, mergeScope?: string): Promise<FundHolder[]>;
  getFundMarketSnapshot(symbol: Symbol): Promise<Quote>;
  getFundHistorical(symbol: Symbol, startMs: number, endMs: number): Promise<Candle[]>;

  // ---------- 特色数据 ----------
  getLimitUpPool(opts?: {
    dateMs?: number;
    page?: number;
    size?: number;
    sortField?: string;
    sortDir?: string;
  }): Promise<ListResult<LimitUpStock>>;
  getLimitUpLadder(): Promise<unknown>;
  getAnomalyList(tagCodes?: string[]): Promise<AnomalyStock[]>;
  getAnomalyByStocks(symbols: Symbol[]): Promise<AnomalyStock[]>;
  getSkyrocketList(period?: 'day' | 'hour'): Promise<HotStock[]>;
  getHotStockList(period?: 'day' | 'hour'): Promise<HotStock[]>;
  getHotStockListHistory(date: string): Promise<HotStock[]>;
  getHotStockRankTrend(symbol: Symbol, startDate: string, endDate: string): Promise<HotStock[]>;
  getDragonTigerList(opts?: { boardType?: string; date?: string }): Promise<DragonTigerList>;

  // ---------- 交易日历 ----------
  getTradingDays(): Promise<TradingDay[]>;
}

/** 数据源统一错误，携带来源标识与上游 code 便于排查 */
export class DataSourceError extends Error {
  /** 上游业务 code（如 3004 不支持），可选 */
  readonly upstreamCode?: number | string;
  constructor(
    message: string,
    public readonly sourceId: string,
    upstreamCode?: number | string,
    public readonly cause?: unknown,
  ) {
    super(`[${sourceId}] ${message}`);
    this.name = 'DataSourceError';
    this.upstreamCode = upstreamCode;
  }

  /** 是否可在有界次数内退避重试 */
  get retryable(): boolean {
    const code = this.upstreamCode;
    if (code === undefined) return true; // 网络错误（无上游 code）
    if (code === 4001) return true; // 限流
    if (typeof code === 'string') return code.startsWith('500');
    return code >= 5000 && code <= 5003;
  }
}
