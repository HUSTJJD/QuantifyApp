/**
 * MarketDataClient —— 行情数据统一访问门面（Facade）。
 *
 * 设计理念：
 *  - APP 唯一数据访问点，业务层只 import { marketData } from '@/data/api'
 *  - 本类只做「门面 / 参数归一化 / 兼容层」，不做调度逻辑
 *  - 所有调度（源选择、兜底、熔断、批量拆分）统一委托给 SourceRouter
 *  - 屏蔽源差异：业务层不需要知道有多少个源、哪个源提供什么能力
 *
 * 架构分层：
 *  MarketDataClient (门面)
 *        ↓
 *  SourceRouter (调度器: 能力发现/兜底/熔断/批量拆分)
 *        ↓
 *  DataSourceRegistry (注册表)
 *        ↓
 *  具体数据源 (hithsa / stock-sdk / ...)
 */
import { QuotesCache, QUOTES_MAX_AGE_MS } from '@/data/cache/QuotesCache';
import { isIndexSymbol, sanitizeSymbol, isNonKlineSymbol } from '@/domain/symbol';
import { getSource, hasSource, listAvailableSources } from './DataSourceRegistry';
import { SourceRouter, applyMethod } from './SourceRouter';
import { DataSourceError } from './MarketDataSource';
import type { DataSourceMethod, MarketDataSource, MethodArgs, MethodResult } from './MarketDataSource';
import { readThroughCache } from './MethodCache';
import { defaultApiConfig, getApiConfig, setApiConfig } from './config';
import { HithsaHttpClient } from './sources/HithsaHttpClient';
import type {
  Symbol,
  Exchange,
  AssetType,
  Quote,
  Candle,
  OrderBook,
  Instrument,
  SearchParams,
  KlineParams,
  AdjustmentFactor,
  Valuation,
  IncomeStatement,
  BalanceSheet,
  CashFlowStatement,
  FinancialIndicator,
  HistoricalFinancialParams,
  IndicatorsParams,
  FinancialReport,
  ProfitForecast,
  IndexInfo,
  IndexTag,
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
  LimitUpStock,
  LimitUpLadder,
  ListResult,
  AnomalyStock,
  HotStock,
  DragonTigerList,
  TradingDay,
  StockInfo,
  NewsItem,
  NewsParams,
  AnnouncementItem,
  AnnouncementParams,
  BlockTradeItem,
  MainForceItem,
  HotItem,
  HolderItem,
  HolderParams,
  LargestHolderItem,
  HolderChangeItem,
  TopListItem,
  LimitDownStock,
  IntradayParams,
  IntradayPoint,
  AHPremiumItem,
  StockNewStockItem,
  StockAHItem,
  TradingCalendarItem,
  FundsFlowingItem,
  FundsFlowingParams,
  HotIndustryItem,
  TodaySurgeItem,
  IndustryBoardItem,
  IndustryBoardParams,
  IndustryBoardConstituentItem,
  IndustryBoardKlineParams,
  IndustryFundsFlowingItem,
  IndustryFundsFlowingParams,
  SectorFundFlowHistoryParams,
  SectorFundFlowPoint,
  DragonTigerInstitutionParams,
  DragonTigerInstitutionStat,
  DragonTigerBranchStat,
  DragonTigerPeriod,
  DragonTigerSeat,
  DragonTigerSeatParams,
  BlockTradeDateParams,
  BlockTradeDailyStat,
  BlockTradeMarketStat,
  DividendDetailItem,
  LimitBreakStock,
  MarketFundFlowPoint,
  EtfOptionCate,
  EtfOptionMonths,
  EtfOptionExpireDay,
  OptionMinutePoint,
  StockChangeType,
  StockChangeEvent,
  IndividualChangeParams,
  IndividualStockChangeEvent,
  DragonTigerStockStat,
  FundDividendListParams,
  FundDividendRecord,
  FundRankHistoryResult,
  LargeOrderRatio,
  AuctionSnapshot,
  AuctionSnapshotParams,
  ShortTermBenchmark,
  Market,
  MarketSessionStatus,
  FundListItem,
  FundRankItem,
  FundValuation,
  FundBonusItem,
  FundAssetItem,
  FundManagerItem,
  FundNewFundItem,
  FundReitsItem,
  FundTradeItem,
  FundStockItem,
  FundFinancingItem,
  FundPerformanceItem,
  FundReferenceItem,
  FundThemeItem,
  FundShareItem,
  FundTopicItem,
  FundCategory,
  OptionQuoteParams,
  OptionKlineParams,
  OptionTQuoteResult,
  OptionKlineBar,
  OptionLhbItem,
  CffexOptionQuote,
  FuturesKlineParams,
  FuturesKlineBar,
  GlobalFuturesQuote,
  FuturesInventorySymbol,
  FuturesInventoryParams,
  FuturesInventoryPoint,
  ComexInventoryPoint,
  NorthboundDirection,
  NorthboundMinutePoint,
  NorthboundFlowSummaryItem,
  NorthboundHoldingRankParams,
  NorthboundHoldingItem,
  NorthboundHistoryParams,
  NorthboundHistoryPoint,
  NorthboundIndividualParams,
  NorthboundIndividualPoint,
  ChipDistributionParams,
  ChipDistributionPoint,
  MarginAccountStat,
  MarginTargetStat,
  ConceptBoardParams,
  ConceptBoardItem,
  ConceptBoardConstituentItem,
  ConceptBoardKlineParams,
} from './types';

export type SourceFactory = (id: string) => MarketDataSource;

export interface ClientOptions {
  /** 自定义源工厂（测试用）；不传则使用 registry 的 getSource（进程内单例缓存） */
  sourceFactory?: SourceFactory;
}

/** 单源直测结果（probeSource） */
export interface SourceProbeResult {
  ok: boolean;
  /** 源明确不支持（能力未声明/未实现/参数级不支持/上游 3004·1002） */
  unsupported: boolean;
  latencyMs: number;
  /** 数组返回条数；非数组为 -1 */
  count: number;
  /** 结果摘要（首条 JSON，非数组/空时省略） */
  sample?: string;
  error?: string;
}

export class MarketDataClient {
  private readonly router: SourceRouter;
  private readonly factory: SourceFactory;

  constructor(opts: ClientOptions = {}) {
    this.factory = opts.sourceFactory ?? ((id: string) => {
      if (!hasSource(id)) throw new Error(`no registered data source: ${id}`);
      return getSource(id);
    });

    this.router = new SourceRouter({
      factory: this.factory,
    });
  }

  /** 获取底层路由器（调试用） */
  getRouter(): SourceRouter {
    return this.router;
  }

  /**
   * 门面统一入口：读穿缓存（MethodCache）→ SourceRouter。
   * 未登记缓存策略的方法直接透传；probeSource 不走本方法（保持真实请求）。
   */
  private call<M extends DataSourceMethod>(
    method: M,
    args: MethodArgs<M>,
  ): Promise<MethodResult<M>> {
    return readThroughCache(method, args, () => this.router.invoke(method, args));
  }

  // ============================================================
  // 一、核心通用能力（统一兜底，所有方法都走 SourceRouter）
  // ============================================================

  // ---------- 元信息 ----------

  async search(query: string | SearchParams): Promise<Instrument[]> {
    const p: SearchParams = typeof query === 'string' ? { keyword: query } : query;
    return this.call('search', [p]);
  }

  async listTickers(opts?: { exchange?: Exchange; assetType?: AssetType; limit?: number; offset?: number }): Promise<Instrument[]> {
    return this.call('listTickers', [opts]);
  }

  // ---------- 行情 ----------

  /**
   * 批量实时行情快照。
   * 使用 partition 模式：混合标的（A股+港股+美股）自动按源拆分，
   * 每个源拉自己支持的部分，最终合并返回。
   *
   * 代码体系差异在内部处理：个股与「指数/板块」在行情源里走不同端点
   * （如 hithsa 的 /api/a-share/prices/* vs /api/a-share-index/prices/*），
   * 这里按标的类型自动分流，调用方无需关心（详见 isIndexSymbol）。
   */
  async getQuotes(symbols: Symbol[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];
    // 清洗脏代码（sh603986 / hk03986 等前缀混入 code 的历史数据）
    const cleaned = symbols.map(sanitizeSymbol);
    // A 股源只认个股/指数数字码：过滤 B 股（200/900）等，避免整批 Unknown
    const aShareOk = cleaned.filter((s) => {
      if (s.exchange === 'HK' || s.exchange === 'US' || s.exchange === 'OF' || s.exchange === 'TI' || s.exchange === 'EM') {
        return true;
      }
      return /^(60\d{4}|68\d{4}|00\d{4}|30\d{4}|8\d{4}|4\d{4}|92\d{4}|000\d{3}|399\d{3})$/.test(s.code);
    });
    const indices = aShareOk.filter((s) => isIndexSymbol(s));
    const stocks = aShareOk.filter((s) => !isIndexSymbol(s));
    const partitionBy = (method: 'getQuotes' | 'getIndexQuotes', subset: Symbol[]) =>
      this.router.partition(
        method,
        subset,
        (s) => `${s.code}.${s.exchange}`,
        (q) => `${q.symbol.code}.${q.symbol.exchange}`,
        (parts) => [parts],
      );
    const [indexQuotes, stockQuotes] = await Promise.all([
      indices.length > 0 ? partitionBy('getIndexQuotes', indices) : Promise.resolve([] as Quote[]),
      stocks.length > 0 ? partitionBy('getQuotes', stocks) : Promise.resolve([] as Quote[]),
    ]);
    return [...indexQuotes, ...stockQuotes];
  }

  async getOrderBook(symbol: Symbol): Promise<OrderBook> {
    return this.call('getOrderBook', [symbol]);
  }

  /**
   * K 线。指数/板块与个股在行情源里走不同端点（且指数无复权语义，
   * adjust 由指数端点自然忽略），这里按标的类型自动分流。
   * 场内基金 / 期权无个股 K 线契约 → 静默空，避免 LogBox 刷屏。
   */
  async getKline(params: KlineParams): Promise<Candle[]> {
    const symbol = sanitizeSymbol(params.symbol);
    if (isNonKlineSymbol(symbol)) return [];
    const method = isIndexSymbol(symbol) ? 'getIndexKline' : 'getKline';
    return this.call(method, [{ ...params, symbol }]);
  }

  /**
   * 复权因子。指数/板块无分红送转语义，直接短路返回空，
   * 避免把指数代码送进个股 corporate-actions 端点触发必败请求。
   * 场内基金 / 期权同样无复权因子。
   */
  async getAdjustmentFactors(symbol: Symbol, from?: string, to?: string): Promise<AdjustmentFactor[]> {
    const s = sanitizeSymbol(symbol);
    if (isIndexSymbol(s) || isNonKlineSymbol(s)) return [];
    return this.call('getAdjustmentFactors', [s, from, to]);
  }

  // ---------- 估值 ----------

  async getValuations(symbols: Symbol[]): Promise<Valuation[]> {
    if (symbols.length === 0) return [];
    // 上游 fuyao 限制 thscodes ≤100；内部自动分片，调用方无需关心
    const CHUNK = 80;
    const cleaned = symbols.map(sanitizeSymbol);
    const out: Valuation[] = [];
    for (let i = 0; i < cleaned.length; i += CHUNK) {
      const batch = cleaned.slice(i, i + CHUNK);
      try {
        const rows = await this.router.partition(
          'getValuations',
          batch,
          (s) => `${s.code}.${s.exchange}`,
          (v) => `${v.symbol.code}.${v.symbol.exchange}`,
          (parts) => [parts],
        );
        out.push(...rows);
      } catch {
        // 单批失败不拖垮其余
      }
    }
    return out;
  }

  // ---------- 财务 ----------

  async getIncomeStatements(params: HistoricalFinancialParams): Promise<IncomeStatement[]> {
    return this.call('getIncomeStatements', [params]);
  }

  async getBalanceSheets(params: HistoricalFinancialParams): Promise<BalanceSheet[]> {
    return this.call('getBalanceSheets', [params]);
  }

  async getCashFlowStatements(params: HistoricalFinancialParams): Promise<CashFlowStatement[]> {
    return this.call('getCashFlowStatements', [params]);
  }

  async getFinancialIndicators(params: IndicatorsParams): Promise<FinancialIndicator[]> {
    return this.call('getFinancialIndicators', [params]);
  }

  async getFinancials(code: string): Promise<FinancialReport[]> {
    return this.call('getFinancials', [code]);
  }

  async getProfitForecast(code: string): Promise<ProfitForecast[]> {
    return this.call('getProfitForecast', [code]);
  }

  // ---------- 指数 / 板块 ----------

  async listIndices(tag?: IndexTag): Promise<IndexInfo[]> {
    return this.call('listIndices', [tag]);
  }

  async getIndexConstituents(symbol: Symbol): Promise<IndexConstituent[]> {
    return this.call('getIndexConstituents', [symbol]);
  }

  async getIndexQuotes(symbols: Symbol[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];
    // 与 getQuotes 一致走 partition：整包 invoke 时若含 BJ 等源不覆盖的段，
    // capabilitySupports 会把整个调用裁掉 → attempted=0 返回空。
    // partition 按单标的 canCall 拆分，SH/SZ 股指给 hithsa/fuyao，EM/BK 给 stock-sdk。
    return this.router.partition(
      'getIndexQuotes',
      symbols,
      (s) => `${s.code}.${s.exchange}`,
      (q) => `${q.symbol.code}.${q.symbol.exchange}`,
      (parts) => [parts],
    );
  }

  async getIndexKline(params: KlineParams): Promise<Candle[]> {
    return this.call('getIndexKline', [params]);
  }

  // ---------- 基金 ----------

  async getFundProfile(symbol: Symbol, fundType: FundType): Promise<FundProfile> {
    return this.call('getFundProfile', [symbol, fundType]);
  }

  async getFundHoldings(symbol: Symbol, fundType: FundType): Promise<FundHolding[]> {
    return this.call('getFundHoldings', [symbol, fundType]);
  }

  async getFundNav(symbol: Symbol, fundType: FundType, range?: FundNavRange, navType?: FundNavType): Promise<FundNav[]> {
    return this.call('getFundNav', [symbol, fundType, range, navType]);
  }

  async getFundReturns(symbol: Symbol, fundType: FundType): Promise<FundReturn> {
    return this.call('getFundReturns', [symbol, fundType]);
  }

  async getFundHolders(symbol: Symbol, fundType: FundType, mergeScope?: FundMergeScope): Promise<FundHolder[]> {
    return this.call('getFundHolders', [symbol, fundType, mergeScope]);
  }

  async getFundMarketSnapshot(symbol: Symbol): Promise<Quote> {
    return this.call('getFundMarketSnapshot', [symbol]);
  }

  async getFundHistorical(symbol: Symbol, startMs: number, endMs: number): Promise<Candle[]> {
    return this.call('getFundHistorical', [symbol, startMs, endMs]);
  }

  // ---------- 特色数据 ----------

  async getLimitUpPool(opts?: {
    dateMs?: number;
    page?: number;
    size?: number;
    sortField?: string;
    sortDir?: string;
  }): Promise<ListResult<LimitUpStock>> {
    return this.call('getLimitUpPool', [opts]);
  }

  async getLimitUpLadder(): Promise<LimitUpLadder> {
    return this.call('getLimitUpLadder', []);
  }

  async getLimitDownPool(opts?: { dateMs?: number; page?: number; size?: number }): Promise<ListResult<LimitDownStock>> {
    return this.call('getLimitDownPool', [opts]);
  }

  async getLimitBreakPool(opts?: { dateMs?: number; page?: number; size?: number }): Promise<ListResult<LimitBreakStock>> {
    return this.call('getLimitBreakPool', [opts]);
  }

  async getMarketFundFlow(): Promise<MarketFundFlowPoint[]> {
    return this.call('getMarketFundFlow', []);
  }

  async getOptionEtfMonths(cate: EtfOptionCate): Promise<EtfOptionMonths> {
    return this.call('getOptionEtfMonths', [cate]);
  }

  async getOptionEtfExpireDay(cate: EtfOptionCate, month: string): Promise<EtfOptionExpireDay> {
    return this.call('getOptionEtfExpireDay', [cate, month]);
  }

  async getOptionEtfMinuteKline(code: string): Promise<OptionMinutePoint[]> {
    return this.call('getOptionEtfMinuteKline', [code]);
  }

  async getKlineWithIndicators(params: {
    symbol: Symbol;
    period?: 'daily' | 'weekly' | 'monthly';
    adjust?: '' | 'qfq' | 'hfq';
    indicators?: Record<string, unknown>;
  }): Promise<Candle[]> {
    return this.call('getKlineWithIndicators', [params]);
  }

  async getKlineSignals(params: {
    symbol: Symbol;
    period?: 'daily' | 'weekly' | 'monthly';
    adjust?: '' | 'qfq' | 'hfq';
    maFast?: number;
    maSlow?: number;
  }): Promise<Array<Record<string, unknown>>> {
    return this.call('getKlineSignals', [params]);
  }

  async getStockChangeEvents(type?: StockChangeType): Promise<StockChangeEvent[]> {
    return this.call('getStockChangeEvents', [type]);
  }

  async getIndividualChangeEvents(params: IndividualChangeParams): Promise<IndividualStockChangeEvent[]> {
    return this.call('getIndividualChangeEvents', [params]);
  }

  async getDragonTigerStockStats(period?: DragonTigerPeriod): Promise<DragonTigerStockStat[]> {
    return this.call('getDragonTigerStockStats', [period]);
  }

  async getFundDividendList(params?: FundDividendListParams): Promise<FundDividendRecord[]> {
    return this.call('getFundDividendList', [params]);
  }

  async getFundRankHistory(symbol: Symbol): Promise<FundRankHistoryResult> {
    return this.call('getFundRankHistory', [symbol]);
  }

  async getLargeOrderRatios(symbols: Symbol[]): Promise<LargeOrderRatio[]> {
    return this.call('getLargeOrderRatios', [symbols]);
  }

  async getAuctionSnapshot(params: AuctionSnapshotParams): Promise<AuctionSnapshot[]> {
    return this.call('getAuctionSnapshot', [params]);
  }

  async getShortTermBenchmark(date?: string): Promise<ShortTermBenchmark[]> {
    return this.call('getShortTermBenchmark', [date]);
  }

  async getMarketStatus(market?: Market): Promise<MarketSessionStatus> {
    return this.call('getMarketStatus', [market]);
  }

  async getAnomalyList(tagCodes?: string[]): Promise<AnomalyStock[]> {
    return this.call('getAnomalyList', [tagCodes]);
  }

  async getAnomalyByStocks(symbols: Symbol[]): Promise<AnomalyStock[]> {
    return this.call('getAnomalyByStocks', [symbols]);
  }

  async getSkyrocketList(period?: 'day' | 'hour'): Promise<HotStock[]> {
    return this.call('getSkyrocketList', [period]);
  }

  async getHotStockList(period?: 'day' | 'hour'): Promise<HotStock[]> {
    return this.call('getHotStockList', [period]);
  }

  async getHotStockListHistory(date: string): Promise<HotStock[]> {
    return this.call('getHotStockListHistory', [date]);
  }

  async getHotStockRankTrend(symbol: Symbol, startDate: string, endDate: string): Promise<HotStock[]> {
    return this.call('getHotStockRankTrend', [symbol, startDate, endDate]);
  }

  async getDragonTigerList(opts?: { boardType?: string; date?: string }): Promise<DragonTigerList> {
    return this.call('getDragonTigerList', [opts]);
  }

  // ---------- 交易日历 ----------

  async getTradingDays(): Promise<TradingDay[]> {
    return this.call('getTradingDays', []);
  }

  async isTradingDay(date?: string): Promise<boolean> {
    return this.call('isTradingDay', [date]);
  }

  async nextTradingDay(date?: string): Promise<string> {
    return this.call('nextTradingDay', [date]);
  }

  async prevTradingDay(date?: string): Promise<string> {
    return this.call('prevTradingDay', [date]);
  }

  // ============================================================
  // 二、扩展能力（stock-sdk 等源提供的额外能力）
  // 这些方法也走统一兜底，但返回类型是扩展类型
  // ============================================================

  // ---------- 个股档案 / 股东 ----------

  async getStockInfo(code: string): Promise<StockInfo> {
    return this.call('getStockInfo', [code]);
  }

  async getHolders(params: HolderParams): Promise<HolderItem[]> {
    return this.call('getHolders', [params]);
  }

  async getLargestHolders(params: HolderParams): Promise<LargestHolderItem[]> {
    return this.call('getLargestHolders', [params]);
  }

  async getHolderChanges(params: HolderParams): Promise<HolderChangeItem[]> {
    return this.call('getHolderChanges', [params]);
  }

  async getTopList(params?: { [k: string]: unknown }): Promise<TopListItem[]> {
    return this.call('getTopList', [params]);
  }

  // ---------- 资讯 / 公告 ----------

  async getNews(params?: NewsParams): Promise<NewsItem[]> {
    return this.call('getNews', [params]);
  }

  async getAnnouncement(params?: AnnouncementParams): Promise<AnnouncementItem[]> {
    return this.call('getAnnouncement', [params]);
  }

  // ---------- 资金流 ----------

  async getMainForce(params: { symbol: Symbol; period?: 'daily' | 'weekly' | 'monthly' }): Promise<MainForceItem[]> {
    return this.call('getMainForce', [params]);
  }

  async getMarketHot(params?: { [k: string]: unknown }): Promise<HotItem[]> {
    return this.call('getMarketHot', [params]);
  }

  async getStockHot(params?: { [k: string]: unknown }): Promise<HotItem[]> {
    return this.call('getStockHot', [params]);
  }

  async getStockFundsFlowing(params?: FundsFlowingParams): Promise<FundsFlowingItem[]> {
    return this.call('getStockFundsFlowing', [params]);
  }

  async getStockHotIndustry(params?: IndustryFundsFlowingParams): Promise<HotIndustryItem[]> {
    return this.call('getStockHotIndustry', [params]);
  }

  async getStockTodaySurge(params?: { limit?: number }): Promise<TodaySurgeItem[]> {
    return this.call('getStockTodaySurge', [params]);
  }

  async getStockIndustryBoard(params?: IndustryBoardParams): Promise<IndustryBoardItem[]> {
    return this.call('getStockIndustryBoard', [params]);
  }

  async getStockIndustryFundsFlowing(params?: IndustryFundsFlowingParams): Promise<IndustryFundsFlowingItem[]> {
    return this.call('getStockIndustryFundsFlowing', [params]);
  }

  async getIndustryBoardConstituents(symbol: Symbol): Promise<IndustryBoardConstituentItem[]> {
    return this.call('getIndustryBoardConstituents', [symbol]);
  }

  async getIndustryBoardKline(params: IndustryBoardKlineParams): Promise<Candle[]> {
    return this.call('getIndustryBoardKline', [params]);
  }

  async getSectorFundFlowHistory(params: SectorFundFlowHistoryParams): Promise<SectorFundFlowPoint[]> {
    return this.call('getSectorFundFlowHistory', [params]);
  }

  async getDragonTigerInstitution(params: DragonTigerInstitutionParams): Promise<DragonTigerInstitutionStat[]> {
    return this.call('getDragonTigerInstitution', [params]);
  }

  async getDragonTigerBranchRank(period?: DragonTigerPeriod): Promise<DragonTigerBranchStat[]> {
    return this.call('getDragonTigerBranchRank', [period]);
  }

  async getDragonTigerSeatDetail(params: DragonTigerSeatParams): Promise<DragonTigerSeat[]> {
    return this.call('getDragonTigerSeatDetail', [params]);
  }

  async getBlockTradeMarketStat(): Promise<BlockTradeMarketStat[]> {
    return this.call('getBlockTradeMarketStat', []);
  }

  async getBlockTradeDailyStat(params?: BlockTradeDateParams): Promise<BlockTradeDailyStat[]> {
    return this.call('getBlockTradeDailyStat', [params]);
  }

  async getDividendDetail(symbol: Symbol): Promise<DividendDetailItem[]> {
    return this.call('getDividendDetail', [symbol]);
  }

  // ---------- 分时（统一入口） ----------

  async getIntraday(params: IntradayParams): Promise<IntradayPoint[]> {
    return this.call('getIntraday', [params]);
  }

  // ---------- A/H 溢价 / 新股 / 日历 ----------

  async getAHPremium(params?: { [k: string]: unknown }): Promise<AHPremiumItem[]> {
    return this.call('getAHPremium', [params]);
  }

  async getStockNewStock(params?: { [k: string]: unknown }): Promise<StockNewStockItem[]> {
    return this.call('getStockNewStock', [params]);
  }

  async getStockAH(params?: { [k: string]: unknown }): Promise<StockAHItem[]> {
    return this.call('getStockAH', [params]);
  }

  async getStockTradingCalendar(params?: { [k: string]: unknown }): Promise<TradingCalendarItem[]> {
    return this.call('getStockTradingCalendar', [params]);
  }

  // ---------- 大宗交易 ----------

  async getBlockTrade(params: { code?: string; [k: string]: unknown }): Promise<BlockTradeItem[]> {
    return this.call('getBlockTrade', [params]);
  }

  // ---------- 基金扩展 ----------

  async getFundList(params?: { type?: string; page?: number; size?: number }): Promise<FundListItem[]> {
    return this.call('getFundList', [params]);
  }

  async getFundRank(params: { type?: string; field?: string; [k: string]: unknown }): Promise<FundRankItem[]> {
    return this.call('getFundRank', [params]);
  }

  async getFundValuation(params: { code: string; [k: string]: unknown }): Promise<FundValuation> {
    return this.call('getFundValuation', [params]);
  }

  async getFundBonus(params: { code: string; [k: string]: unknown }): Promise<FundBonusItem[]> {
    return this.call('getFundBonus', [params]);
  }

  async getFundAsset(params: { code: string; [k: string]: unknown }): Promise<FundAssetItem[]> {
    return this.call('getFundAsset', [params]);
  }

  async getFundManager(params: { code: string; [k: string]: unknown }): Promise<FundManagerItem[]> {
    return this.call('getFundManager', [params]);
  }

  async getFundNewFund(params?: { [k: string]: unknown }): Promise<FundNewFundItem[]> {
    return this.call('getFundNewFund', [params]);
  }

  async getFundReits(params?: { [k: string]: unknown }): Promise<FundReitsItem[]> {
    return this.call('getFundReits', [params]);
  }

  async getFundTrades(params?: { [k: string]: unknown }): Promise<FundTradeItem[]> {
    return this.call('getFundTrades', [params]);
  }

  async getFundStock(params: { code: string; [k: string]: unknown }): Promise<FundStockItem[]> {
    return this.call('getFundStock', [params]);
  }

  async getFundFinancing(params?: { [k: string]: unknown }): Promise<FundFinancingItem[]> {
    return this.call('getFundFinancing', [params]);
  }

  async getFundPerformance(params?: { [k: string]: unknown }): Promise<FundPerformanceItem[]> {
    return this.call('getFundPerformance', [params]);
  }

  async getFundReference(params?: { [k: string]: unknown }): Promise<FundReferenceItem[]> {
    return this.call('getFundReference', [params]);
  }

  async getFundTheme(params?: { [k: string]: unknown }): Promise<FundThemeItem[]> {
    return this.call('getFundTheme', [params]);
  }

  async getFundShare(params: { code: string; [k: string]: unknown }): Promise<FundShareItem[]> {
    return this.call('getFundShare', [params]);
  }

  async getFundTopics(params?: { [k: string]: unknown }): Promise<FundTopicItem[]> {
    return this.call('getFundTopics', [params]);
  }

  async getFundCategories(): Promise<FundCategory[]> {
    return this.call('getFundCategories', []);
  }

  // ---------- 期权 ----------

  async getOptionQuotes(params: OptionQuoteParams): Promise<OptionTQuoteResult> {
    return this.call('getOptionQuotes', [params]);
  }

  async getOptionKline(params: OptionKlineParams): Promise<OptionKlineBar[]> {
    return this.call('getOptionKline', [params]);
  }

  async getOptionCffexQuotes(opts?: { pageSize?: number }): Promise<CffexOptionQuote[]> {
    return this.call('getOptionCffexQuotes', [opts]);
  }

  async getOptionLhb(params: { symbol: Symbol; date: string }): Promise<OptionLhbItem[]> {
    return this.call('getOptionLhb', [params]);
  }

  // ---------- 期货 ----------

  async getFuturesKline(params: FuturesKlineParams): Promise<FuturesKlineBar[]> {
    return this.call('getFuturesKline', [params]);
  }

  async getFuturesGlobalSpot(opts?: { pageSize?: number }): Promise<GlobalFuturesQuote[]> {
    return this.call('getFuturesGlobalSpot', [opts]);
  }

  async getFuturesGlobalKline(params: FuturesKlineParams): Promise<FuturesKlineBar[]> {
    return this.call('getFuturesGlobalKline', [params]);
  }

  async getFuturesInventorySymbols(): Promise<FuturesInventorySymbol[]> {
    return this.call('getFuturesInventorySymbols', []);
  }

  async getFuturesInventory(params: FuturesInventoryParams): Promise<FuturesInventoryPoint[]> {
    return this.call('getFuturesInventory', [params]);
  }

  async getFuturesComexInventory(params: { metal: 'gold' | 'silver'; startMs?: number; endMs?: number }): Promise<ComexInventoryPoint[]> {
    return this.call('getFuturesComexInventory', [params]);
  }

  // ---------- 北向资金 ----------

  async getNorthboundMinute(direction?: NorthboundDirection): Promise<NorthboundMinutePoint[]> {
    return this.call('getNorthboundMinute', [direction]);
  }

  async getNorthboundSummary(): Promise<NorthboundFlowSummaryItem[]> {
    return this.call('getNorthboundSummary', []);
  }

  async getNorthboundHoldingRank(params?: NorthboundHoldingRankParams): Promise<NorthboundHoldingItem[]> {
    return this.call('getNorthboundHoldingRank', [params]);
  }

  async getNorthboundHistory(params?: NorthboundHistoryParams): Promise<NorthboundHistoryPoint[]> {
    return this.call('getNorthboundHistory', [params]);
  }

  async getNorthboundIndividual(params: NorthboundIndividualParams): Promise<NorthboundIndividualPoint[]> {
    return this.call('getNorthboundIndividual', [params]);
  }

  // ---------- 筹码分布 ----------

  async getChipDistribution(params: ChipDistributionParams): Promise<ChipDistributionPoint[]> {
    return this.call('getChipDistribution', [params]);
  }

  // ---------- 融资融券 ----------

  async getMarginAccountInfo(): Promise<MarginAccountStat[]> {
    return this.call('getMarginAccountInfo', []);
  }

  async getMarginTargetList(date?: string): Promise<MarginTargetStat[]> {
    return this.call('getMarginTargetList', [date]);
  }

  // ---------- 概念板块 ----------

  async getConceptBoards(params?: ConceptBoardParams): Promise<ConceptBoardItem[]> {
    return this.call('getConceptBoards', [params]);
  }

  async getConceptBoardConstituents(symbol: Symbol): Promise<ConceptBoardConstituentItem[]> {
    return this.call('getConceptBoardConstituents', [symbol]);
  }

  async getConceptBoardKline(params: ConceptBoardKlineParams): Promise<Candle[]> {
    return this.call('getConceptBoardKline', [params]);
  }

  // ============================================================
  // 三、通用扩展方法（动态调用任意源方法）
  // ============================================================

  /**
   * 动态调用任意方法（用于扩展能力，返回类型由方法签名派生）。
   * 当业务层需要调用某个源的专属能力（如期权/期货）时使用。
   * 核心方法建议直接使用 MarketDataClient 上的强类型方法。
   */
  async invoke<M extends DataSourceMethod>(method: M, ...args: unknown[]): Promise<MethodResult<M>> {
    // 动态分发边界 cast：运行时参数统一按 unknown[] 传递，类型已由方法签名（MethodArgs）校验
    return this.call(method, args as MethodArgs<M>);
  }

  // ============================================================
  // 四、单源直测（供「行情源统计 → 单源测试」入口使用）
  // ============================================================

  /**
   * 对指定行情源直接发起一次真实调用。
   *  - 基于统一封装方法（参数契约与 SourceRouter 一致），但不走兜底/熔断；
   *  - 不写入 apiStats 埋点（避免手动测试污染日常统计）；
   *  - 源未声明能力 / 未实现函数 / 参数级不支持（1002/3004）时直接返回 unsupported，不发请求。
   */
  async probeSource<M extends DataSourceMethod>(
    sourceId: string,
    method: M,
    args: MethodArgs<M>,
  ): Promise<SourceProbeResult> {
    const t0 = Date.now();
    const latency = () => Date.now() - t0;

    let src: MarketDataSource;
    try {
      src = this.factory(sourceId);
    } catch (e) {
      return {
        ok: false,
        unsupported: true,
        latencyMs: latency(),
        count: -1,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    // 能力裁剪：未声明直接判定不支持（不发请求）
    if (src.capabilities && src.capabilities.size > 0 && !src.capabilities.has(method)) {
      return { ok: false, unsupported: true, latencyMs: latency(), count: -1, error: '该源未声明此能力' };
    }
    try {
      if (typeof src.supports === 'function' && !src.supports(method, args)) {
        return { ok: false, unsupported: true, latencyMs: latency(), count: -1, error: '参数级不支持当前测试标的' };
      }
    } catch {
      /* supports 异常不阻断，交由真实调用反馈 */
    }

    try {
      // 统一分发入口（applyMethod）：方法未实现时抛 DataSourceError(3004)，由下方 catch 归入 unsupported
      const res = await applyMethod(src, method, args as unknown[]);
      const ok = res !== undefined && res !== null && !(Array.isArray(res) && res.length === 0);
      if (!ok) {
        return {
          ok: false,
          unsupported: false,
          latencyMs: latency(),
          count: Array.isArray(res) ? 0 : -1,
          error: res === undefined || res === null ? '返回空' : '返回空数组',
        };
      }
      const count = Array.isArray(res) ? res.length : -1;
      const first = Array.isArray(res) ? res[0] : res;
      const sample =
        first != null && typeof first === 'object'
          ? JSON.stringify(first).slice(0, 60)
          : typeof first === 'string' || typeof first === 'number'
            ? String(first).slice(0, 60)
            : undefined;
      return { ok: true, unsupported: false, latencyMs: latency(), count, sample };
    } catch (e) {
      const dse = e instanceof DataSourceError ? e : undefined;
      const unsupported = dse ? dse.isUnsupported : false;
      const msg = dse
        ? dse.message.replace(/^\[[^\]]+\]\s*/, '')
        : e instanceof Error
          ? e.message
          : String(e);
      return { ok: false, unsupported, latencyMs: latency(), count: -1, error: msg || '未知错误' };
    }
  }

  // ============================================================
  // 五、配置与管理
  // ============================================================

  /** 当前主源 id（兼容 activeSourceId 读取） */
  get activeSourceId(): string {
    return getApiConfig().sourceOrder[0] ?? '';
  }

  /** 列出已注册源 */
  listSources() {
    return listAvailableSources();
  }

  /** 设置源优先级顺序 */
  setSourceOrder(order: string[]): void {
    setApiConfig({ ...getApiConfig(), sourceOrder: order });
  }

  /** 设置 API Key（统一收敛到同花顺 HttpClient） */
  setApiKey(key: string): void {
    HithsaHttpClient.setDefaultKey(key);
  }

  /** 回灌用户偏好 */
  applyUserPreferences(key?: string): Promise<void> {
    if (key) HithsaHttpClient.setDefaultKey(key);
    return Promise.resolve();
  }

  // ============================================================
  // 六、缓存管理
  // ============================================================

  /** 清理过期的行情快照缓存 */
  async pruneQuotesCache(): Promise<void> {
    await QuotesCache.pruneExpired(QUOTES_MAX_AGE_MS);
  }

  /** 设置主源（sourceOrder 置顶） */
  setPreferredSource(id: string): void {
    const order = getApiConfig().sourceOrder.filter((x) => x !== id);
    this.setSourceOrder([id, ...order]);
  }
}

/** 默认单例 */
let _defaultClient: MarketDataClient | null = null;
export function getDefaultClient(): MarketDataClient {
  if (!_defaultClient) _defaultClient = new MarketDataClient();
  return _defaultClient;
}

/** APP 全局唯一访问点，业务层统一从这里取数：import { marketData } from '@/data/api' */
export const marketData: MarketDataClient = new MarketDataClient();

export { defaultApiConfig };
