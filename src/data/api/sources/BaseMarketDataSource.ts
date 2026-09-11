/**
 * BaseMarketDataSource —— MarketDataSource 的「默认全不支持」基类。
 *
 * 用途：对只覆盖部分能力的真实数据源，继承本类即可自动获得
 * "所有未覆盖方法统一抛 3004"的行为，无需逐条手写。
 * 子类只需 override 自己真正支持的方法，并在 capabilities 中声明。
 *
 * 设计改进：
 *  - capabilities 作为唯一真相源：声明了才视为支持；
 *  - supports() 默认按 capabilities 判断，子类按需覆盖参数级裁剪；
 *  - 未覆盖的方法统一抛 DataSourceError(3004)，交由 SourceRouter 路由兜底。
 */
import { DataSourceError } from '../MarketDataSource';
import type { DataSourceMethod, MarketDataSource, MethodArgs } from '../MarketDataSource';
import { capabilitySupports, EMPTY_CAPABILITY_SPEC } from '../capability';
import type { CapabilitySpec } from '../capability';
import type {
  Symbol,
  Quote,
  Candle,
  OrderBook,
  Valuation,
  IncomeStatement,
  BalanceSheet,
  CashFlowStatement,
  FinancialIndicator,
  FinancialReport,
  ProfitForecast,
  HistoricalFinancialParams,
  IndicatorsParams,
  AdjustmentFactor,
  IndexTag,
  IndexInfo,
  IndexConstituent,
  FundType,
  FundProfile,
  FundHolding,
  FundNav,
  FundNavRange,
  FundNavType,
  FundMergeScope,
  FundReturn,
  FundHolder,
  ListResult,
  LimitBreakStock,
  LimitDownStock,
  LimitUpLadder,
  LimitUpStock,
  AnomalyStock,
  HotStock,
  DragonTigerList,
  TradingDay,
  Instrument,
  SearchParams,
  KlineParams,
  Exchange,
  AssetType,
} from '../types';

export abstract class BaseMarketDataSource implements MarketDataSource {
  abstract readonly id: string;
  abstract readonly label: string;
  abstract init(): Promise<void>;
  abstract dispose(): Promise<void>;

  /**
   * 能力自声明：本源原生支持的方法白名单（方法级裁剪）。
   * 子类必须覆盖声明自己实现的方法集；未声明的方法视为「不支持」。
   */
  readonly capabilities: ReadonlySet<DataSourceMethod> = new Set();

  /**
   * 参数级能力规格（声明式数据表）：子类覆盖以声明自己的参数级白名单。
   * 决策统一走 capability.ts 的通用引擎（capabilitySupports），源文件不再手写 if/else。
   * 默认空规格 = 无参数级限制（方法级裁剪已由 capabilities 完成）。
   */
  protected readonly spec: CapabilitySpec = EMPTY_CAPABILITY_SPEC;

  /**
   * 参数级能力裁剪：由 spec 数据表 + 通用引擎驱动。
   * 有特殊规则的源（如 stock-sdk 的 BK 板块码格式）可 override 后委托 super 兜底通用部分。
   */
  supports<M extends DataSourceMethod>(method: M, args: MethodArgs<M>): boolean {
    // 动态分发边界 cast：参数类型已按方法签名（MethodArgs）校验，运行时统一按未类型化数组读取
    return capabilitySupports(this.spec, method, args as unknown[]);
  }

  /** 子类不支持的方法统一抛 3004，交由 SourceRouter 路由兜底源（method 可含动态上下文，故保持 string） */
  protected unsupported(method: string): never {
    throw new DataSourceError(`数据源不支持 ${method}`, this.id, 3004);
  }

  // ---------- 元信息 ----------
  search(_p: SearchParams): Promise<Instrument[]> {
    return this.unsupported('search');
  }
  listTickers(_o?: {
    exchange?: Exchange;
    assetType?: AssetType;
    limit?: number;
    offset?: number;
  }): Promise<Instrument[]> {
    return this.unsupported('listTickers');
  }

  // ---------- 行情 ----------
  getQuotes(_s: Symbol[]): Promise<Quote[]> {
    return this.unsupported('getQuotes');
  }
  getOrderBook(_s: Symbol): Promise<OrderBook> {
    return this.unsupported('getOrderBook');
  }
  getKline(_p: KlineParams): Promise<Candle[]> {
    return this.unsupported('getKline');
  }
  getAdjustmentFactors(_s: Symbol, _f?: string, _t?: string): Promise<AdjustmentFactor[]> {
    return this.unsupported('getAdjustmentFactors');
  }

  // ---------- 估值 ----------
  getValuations(_s: Symbol[]): Promise<Valuation[]> {
    return this.unsupported('getValuations');
  }

  // ---------- 财务 ----------
  getIncomeStatements(_p: HistoricalFinancialParams): Promise<IncomeStatement[]> {
    return this.unsupported('getIncomeStatements');
  }
  getBalanceSheets(_p: HistoricalFinancialParams): Promise<BalanceSheet[]> {
    return this.unsupported('getBalanceSheets');
  }
  getCashFlowStatements(_p: HistoricalFinancialParams): Promise<CashFlowStatement[]> {
    return this.unsupported('getCashFlowStatements');
  }
  getFinancialIndicators(_p: IndicatorsParams): Promise<FinancialIndicator[]> {
    return this.unsupported('getFinancialIndicators');
  }
  getFinancials(_c: string): Promise<FinancialReport[]> {
    return this.unsupported('getFinancials');
  }
  getProfitForecast(_c: string): Promise<ProfitForecast[]> {
    return this.unsupported('getProfitForecast');
  }

  // ---------- 指数 / 板块 ----------
  listIndices(_tag?: IndexTag): Promise<IndexInfo[]> {
    return this.unsupported('listIndices');
  }
  getIndexConstituents(_s: Symbol): Promise<IndexConstituent[]> {
    return this.unsupported('getIndexConstituents');
  }
  getIndexQuotes(_s: Symbol[]): Promise<Quote[]> {
    return this.unsupported('getIndexQuotes');
  }
  getIndexKline(_p: KlineParams): Promise<Candle[]> {
    return this.unsupported('getIndexKline');
  }

  // ---------- 基金 ----------
  getFundProfile(_s: Symbol, _t: FundType): Promise<FundProfile> {
    return this.unsupported('getFundProfile');
  }
  getFundHoldings(_s: Symbol, _t: FundType): Promise<FundHolding[]> {
    return this.unsupported('getFundHoldings');
  }
  getFundNav(_s: Symbol, _t: FundType, _r?: FundNavRange, _n?: FundNavType): Promise<FundNav[]> {
    return this.unsupported('getFundNav');
  }
  getFundReturns(_s: Symbol, _t: FundType): Promise<FundReturn> {
    return this.unsupported('getFundReturns');
  }
  getFundHolders(_s: Symbol, _t: FundType, _m?: FundMergeScope): Promise<FundHolder[]> {
    return this.unsupported('getFundHolders');
  }
  getFundMarketSnapshot(_s: Symbol): Promise<Quote> {
    return this.unsupported('getFundMarketSnapshot');
  }
  getFundHistorical(_s: Symbol, _startMs: number, _endMs: number): Promise<Candle[]> {
    return this.unsupported('getFundHistorical');
  }

  // ---------- 特色数据 ----------
  getLimitUpPool(_o?: {
    dateMs?: number;
    page?: number;
    size?: number;
    sortField?: string;
    sortDir?: string;
  }): Promise<ListResult<LimitUpStock>> {
    return this.unsupported('getLimitUpPool');
  }
  getLimitUpLadder(): Promise<LimitUpLadder> {
    return this.unsupported('getLimitUpLadder');
  }
  getLimitDownPool(_o?: {
    dateMs?: number;
    page?: number;
    size?: number;
  }): Promise<ListResult<LimitDownStock>> {
    return this.unsupported('getLimitDownPool');
  }
  getLimitBreakPool(_o?: {
    dateMs?: number;
    page?: number;
    size?: number;
  }): Promise<ListResult<LimitBreakStock>> {
    return this.unsupported('getLimitBreakPool');
  }
  getAnomalyList(_t?: string[]): Promise<AnomalyStock[]> {
    return this.unsupported('getAnomalyList');
  }
  getAnomalyByStocks(_s: Symbol[]): Promise<AnomalyStock[]> {
    return this.unsupported('getAnomalyByStocks');
  }
  getSkyrocketList(_p?: 'day' | 'hour'): Promise<HotStock[]> {
    return this.unsupported('getSkyrocketList');
  }
  getHotStockList(_p?: 'day' | 'hour'): Promise<HotStock[]> {
    return this.unsupported('getHotStockList');
  }
  getHotStockListHistory(_d: string): Promise<HotStock[]> {
    return this.unsupported('getHotStockListHistory');
  }
  getHotStockRankTrend(_s: Symbol, _sd: string, _ed: string): Promise<HotStock[]> {
    return this.unsupported('getHotStockRankTrend');
  }
  getDragonTigerList(_o?: { boardType?: string; date?: string }): Promise<DragonTigerList> {
    return this.unsupported('getDragonTigerList');
  }

  // ---------- 交易日历 ----------
  getTradingDays(): Promise<TradingDay[]> {
    return this.unsupported('getTradingDays');
  }
  isTradingDay(_d?: string): Promise<boolean> {
    return this.unsupported('isTradingDay');
  }
  nextTradingDay(_d?: string): Promise<string> {
    return this.unsupported('nextTradingDay');
  }
  prevTradingDay(_d?: string): Promise<string> {
    return this.unsupported('prevTradingDay');
  }
}
