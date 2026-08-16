/**
 * BaseMarketDataSource —— MarketDataSource 的「默认全不支持」基类。
 *
 * 用途：对只覆盖部分能力的真实数据源（如 StockApiSource 仅封装行情/K线/搜索），
 * 继承本类即可自动获得"所有未覆盖方法统一抛 3004"的行为，无需逐条手写。
 * 子类只需 override 自己真正支持的方法。
 *
 * 注意：unsupported 返回 never，可安全赋值给任意具体返回类型。
 */
import { DataSourceError } from '../MarketDataSource';
import type { MarketDataSource } from '../MarketDataSource';
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
  FundReturn,
  FundHolder,
  ListResult,
  LimitUpStock,
  AnomalyStock,
  HotStock,
  DragonTigerList,
  TradingDay,
  Instrument,
  SearchParams,
  KlineParams,
} from '../types';

const SOURCE_ID = 'base';

export abstract class BaseMarketDataSource implements MarketDataSource {
  readonly id: string = SOURCE_ID;
  readonly label: string = 'base';
  abstract init(): Promise<void>;
  abstract dispose(): Promise<void>;

  /** 子类不支持的方法统一抛 3004，交由 MarketDataClient 路由兜底源 */
  protected unsupported(method: string): never {
    throw new DataSourceError(`数据源不支持 ${method}`, this.id, 3004);
  }

  // ---------- 元信息 ----------
  search(_p: SearchParams): Promise<Instrument[]> {
    return this.unsupported('search');
  }
  listTickers(_o?: {
    exchange?: string;
    assetType?: string;
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
  getFundNav(_s: Symbol, _t: FundType, _r?: string, _n?: string): Promise<FundNav[]> {
    return this.unsupported('getFundNav');
  }
  getFundReturns(_s: Symbol, _t: FundType): Promise<FundReturn> {
    return this.unsupported('getFundReturns');
  }
  getFundHolders(_s: Symbol, _t: FundType, _m?: string): Promise<FundHolder[]> {
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
  getLimitUpLadder(): Promise<unknown> {
    return this.unsupported('getLimitUpLadder');
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
}
