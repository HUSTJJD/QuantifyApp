/**
 * methods.ts —— 数据源方法签名的唯一真相源（类型安全基础）。
 *
 * 设计：
 *  - DataSourceCoreMethods：34 个核心方法签名接口（所有数据源必须实现）；
 *  - DataSourceExtendedMethods：54 个扩展方法签名接口（各源按需实现，接口侧为 Partial）；
 *  - 方法名/参数/返回类型全部由这两个接口派生，替代此前的字符串方法名 + any 参数：
 *      DataSourceMethod = keyof 派生（88 个方法名，编译期校验）
 *      MethodArgs<M>    = Parameters<...> 派生（调用参数类型安全）
 *      MethodResult<M>  = Awaited<ReturnType<...>> 派生（返回类型安全，已解 Promise）
 *      MethodItem<M>    = 首参为数组类型时的元素类型（partition 拆分用）
 *      MethodRow<M>     = 返回为数组时的行类型（partition 合并用）
 *
 * 注意：本文件只定义「数据源方法」的签名契约；调用侧（SourceRouter.applyMethod）
 * 是全仓唯一的动态分发边界。新增方法时只需在对应接口加一行签名，
 * 方法名联合/参数/返回类型自动派生，无需维护字符串清单。
 */
import type {
  FinancialIndicator,
  FinancialReport,
  FuturesInventoryParams,
  FuturesInventoryPoint,
  FuturesInventorySymbol,
  FuturesKlineBar,
  FuturesKlineParams,
  GlobalFuturesQuote,
  HistoricalFinancialParams,
  HotIndustryItem,
  HotItem,
  HotStock,
  HolderChangeItem,
  HolderItem,
  HolderParams,
  IncomeStatement,
  IndexConstituent,
  IndexInfo,
  IndexTag,
  IndicatorsParams,
  IndustryBoardItem,
  IndustryBoardParams,
  IndustryBoardConstituentItem,
  IndustryBoardKlineParams,
  IndustryFundsFlowingItem,
  IndustryFundsFlowingParams,
  Instrument,
  IntradayParams,
  IntradayPoint,
  FundsFlowingItem,
  FundsFlowingParams,
  KlineParams,
  LargestHolderItem,
  LimitBreakStock,
  LimitDownStock,
  LimitUpLadder,
  LimitUpStock,
  ListResult,
  MainForceItem,
  MarginAccountStat,
  MarginTargetStat,
  NewsItem,
  NewsParams,
  AnnouncementItem,
  AnnouncementParams,
  BlockTradeDateParams,
  BlockTradeDailyStat,
  BlockTradeMarketStat,
  DividendDetailItem,
  DragonTigerBranchStat,
  DragonTigerInstitutionParams,
  DragonTigerInstitutionStat,
  DragonTigerPeriod,
  DragonTigerSeat,
  DragonTigerSeatParams,
  SectorFundFlowHistoryParams,
  SectorFundFlowPoint,
  NorthboundDirection,
  NorthboundFlowSummaryItem,
  NorthboundHistoryParams,
  NorthboundHistoryPoint,
  NorthboundHoldingItem,
  NorthboundHoldingRankParams,
  NorthboundIndividualParams,
  NorthboundIndividualPoint,
  NorthboundMinutePoint,
  OptionKlineBar,
  OptionKlineParams,
  OptionLhbItem,
  OptionQuoteParams,
  OptionTQuoteResult,
  OrderBook,
  ProfitForecast,
  Quote,
  SearchParams,
  StockAHItem,
  StockInfo,
  StockNewStockItem,
  Symbol,
  TodaySurgeItem,
  TopListItem,
  TradingCalendarItem,
  TradingDay,
  AHPremiumItem,
  Valuation,
  FundAssetItem,
  FundBonusItem,
  FundCategory,
  FundFinancingItem,
  FundHolder,
  FundHolding,
  FundListItem,
  FundManagerItem,
  FundMergeScope,
  FundNav,
  FundNavRange,
  FundNavType,
  FundNewFundItem,
  FundPerformanceItem,
  FundProfile,
  FundRankItem,
  FundReferenceItem,
  FundReitsItem,
  FundReturn,
  FundStockItem,
  FundThemeItem,
  FundTopicItem,
  FundShareItem,
  FundTradeItem,
  FundType,
  FundValuation,
  Candle,
  CashFlowStatement,
  CffexOptionQuote,
  ChipDistributionParams,
  ChipDistributionPoint,
  ConceptBoardConstituentItem,
  ConceptBoardItem,
  ConceptBoardKlineParams,
  ConceptBoardParams,
  ComexInventoryPoint,
  DragonTigerList,
  DragonTigerStockStat,
  EtfOptionCate,
  EtfOptionExpireDay,
  EtfOptionMonths,
  Exchange,
  FundDividendListParams,
  FundDividendRecord,
  FundRankHistoryResult,
  AuctionSnapshot,
  AuctionSnapshotParams,
  IndividualChangeParams,
  IndividualStockChangeEvent,
  LargeOrderRatio,
  Market,
  MarketFundFlowPoint,
  MarketSessionStatus,
  OptionMinutePoint,
  ShortTermBenchmark,
  StockChangeEvent,
  StockChangeType,
  AssetType,
  AdjustmentFactor,
  AnomalyStock,
  BalanceSheet,
  BlockTradeItem,
} from './types';

// ============================================================
// 核心方法签名（34 个，所有数据源必须实现）
// ============================================================

export interface DataSourceCoreMethods {
  // ---------- 元信息 ----------
  search(params: SearchParams): Promise<Instrument[]>;
  listTickers(opts?: {
    exchange?: Exchange;
    assetType?: AssetType;
    limit?: number;
    offset?: number;
  }): Promise<Instrument[]>;

  // ---------- 行情 ----------
  /** 统一实时行情：按 Symbol.exchange 自动路由到 A/HK/US/基金端点 */
  getQuotes(symbols: Symbol[]): Promise<Quote[]>;
  getOrderBook(symbol: Symbol): Promise<OrderBook>;
  /** 统一历史 K 线：按 Symbol.exchange 自动路由，无需上层感知市场 */
  getKline(params: KlineParams): Promise<Candle[]>;
  getAdjustmentFactors(symbol: Symbol, from?: string, to?: string): Promise<AdjustmentFactor[]>;

  // ---------- 估值 ----------
  getValuations(symbols: Symbol[]): Promise<Valuation[]>;

  // ---------- 财务 ----------
  getIncomeStatements(params: HistoricalFinancialParams): Promise<IncomeStatement[]>;
  getBalanceSheets(params: HistoricalFinancialParams): Promise<BalanceSheet[]>;
  getCashFlowStatements(params: HistoricalFinancialParams): Promise<CashFlowStatement[]>;
  getFinancialIndicators(params: IndicatorsParams): Promise<FinancialIndicator[]>;
  getFinancials(code: string): Promise<FinancialReport[]>;
  getProfitForecast(code: string): Promise<ProfitForecast[]>;

  // ---------- 指数 / 板块 ----------
  listIndices(tag?: IndexTag): Promise<IndexInfo[]>;
  getIndexConstituents(symbol: Symbol): Promise<IndexConstituent[]>;
  getIndexQuotes(symbols: Symbol[]): Promise<Quote[]>;
  getIndexKline(params: KlineParams): Promise<Candle[]>;

  // ---------- 基金 ----------
  getFundProfile(symbol: Symbol, fundType: FundType): Promise<FundProfile>;
  getFundHoldings(symbol: Symbol, fundType: FundType): Promise<FundHolding[]>;
  getFundNav(symbol: Symbol, fundType: FundType, range?: FundNavRange, navType?: FundNavType): Promise<FundNav[]>;
  getFundReturns(symbol: Symbol, fundType: FundType): Promise<FundReturn>;
  getFundHolders(symbol: Symbol, fundType: FundType, mergeScope?: FundMergeScope): Promise<FundHolder[]>;
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
  getLimitUpLadder(): Promise<LimitUpLadder>;
  /** 跌停池（与 getLimitUpPool 对称） */
  getLimitDownPool(opts?: {
    dateMs?: number;
    page?: number;
    size?: number;
  }): Promise<ListResult<LimitDownStock>>;
  /** 炸板池（fuyao limitBreakPool） */
  getLimitBreakPool(opts?: {
    dateMs?: number;
    page?: number;
    size?: number;
  }): Promise<ListResult<LimitBreakStock>>;
  getAnomalyList(tagCodes?: string[]): Promise<AnomalyStock[]>;
  getAnomalyByStocks(symbols: Symbol[]): Promise<AnomalyStock[]>;
  getSkyrocketList(period?: 'day' | 'hour'): Promise<HotStock[]>;
  getHotStockList(period?: 'day' | 'hour'): Promise<HotStock[]>;
  getHotStockListHistory(date: string): Promise<HotStock[]>;
  getHotStockRankTrend(symbol: Symbol, startDate: string, endDate: string): Promise<HotStock[]>;
  getDragonTigerList(opts?: { boardType?: string; date?: string }): Promise<DragonTigerList>;

  // ---------- 交易日历 ----------
  getTradingDays(): Promise<TradingDay[]>;
  /** 判断是否 A 股交易日 */
  isTradingDay(date?: string): Promise<boolean>;
  /** 下一交易日（YYYY-MM-DD） */
  nextTradingDay(date?: string): Promise<string>;
  /** 上一交易日（YYYY-MM-DD） */
  prevTradingDay(date?: string): Promise<string>;
}

// ============================================================
// 扩展方法签名（各源按需实现；数据源接口侧为 Partial）
// ============================================================

export interface DataSourceExtendedMethods {
  // ---------- 个股档案 / 股东 ----------
  getStockInfo(code: string): Promise<StockInfo>;
  /** 股东名册（入参 Symbol，返回统一股东结构） */
  getHolders(params: HolderParams): Promise<HolderItem[]>;
  getLargestHolders(params: HolderParams): Promise<LargestHolderItem[]>;
  getHolderChanges(params: HolderParams): Promise<HolderChangeItem[]>;
  getTopList(params?: { [k: string]: unknown }): Promise<TopListItem[]>;

  // ---------- 资讯 / 公告 ----------
  /** 统一资讯入口（market/kind 过滤，不再按市场拆方法） */
  getNews(params?: NewsParams): Promise<NewsItem[]>;
  getAnnouncement(params?: AnnouncementParams): Promise<AnnouncementItem[]>;

  // ---------- 资金流 ----------
  /** 个股主力资金历史（stock-sdk fundFlow.individual） */
  getMainForce(params: { symbol: Symbol; period?: 'daily' | 'weekly' | 'monthly' }): Promise<MainForceItem[]>;
  getMarketHot(params?: { [k: string]: unknown }): Promise<HotItem[]>;
  getStockHot(params?: { [k: string]: unknown }): Promise<HotItem[]>;
  /** 个股资金流排行 */
  getStockFundsFlowing(params?: FundsFlowingParams): Promise<FundsFlowingItem[]>;
  getStockHotIndustry(params?: IndustryFundsFlowingParams): Promise<HotIndustryItem[]>;
  getStockTodaySurge(params?: { limit?: number }): Promise<TodaySurgeItem[]>;
  getStockIndustryBoard(params?: IndustryBoardParams): Promise<IndustryBoardItem[]>;
  /** 板块资金流排行 */
  getStockIndustryFundsFlowing(params?: IndustryFundsFlowingParams): Promise<IndustryFundsFlowingItem[]>;
  /** 行业板块成分股 */
  getIndustryBoardConstituents(symbol: Symbol): Promise<IndustryBoardConstituentItem[]>;
  /** 行业板块 K 线 → 统一 Candle */
  getIndustryBoardKline(params: IndustryBoardKlineParams): Promise<Candle[]>;
  /** 板块资金流历史 */
  getSectorFundFlowHistory(params: SectorFundFlowHistoryParams): Promise<SectorFundFlowPoint[]>;

  // ---------- 龙虎榜细分 ----------
  /** 龙虎榜机构买卖 */
  getDragonTigerInstitution(params: DragonTigerInstitutionParams): Promise<DragonTigerInstitutionStat[]>;
  /** 龙虎榜营业部排行 */
  getDragonTigerBranchRank(period?: DragonTigerPeriod): Promise<DragonTigerBranchStat[]>;
  /** 龙虎榜个股席位明细 */
  getDragonTigerSeatDetail(params: DragonTigerSeatParams): Promise<DragonTigerSeat[]>;

  // ---------- 大宗交易细分 ----------
  /** 大宗交易市场统计（按日） */
  getBlockTradeMarketStat(): Promise<BlockTradeMarketStat[]>;
  /** 大宗交易按股日统计 */
  getBlockTradeDailyStat(params?: BlockTradeDateParams): Promise<BlockTradeDailyStat[]>;

  // ---------- 分红明细 ----------
  getDividendDetail(symbol: Symbol): Promise<DividendDetailItem[]>;

  // ---------- P2 闭环补录 ----------
  /** 大盘资金流（按日） */
  getMarketFundFlow(): Promise<MarketFundFlowPoint[]>;
  /** ETF 期权合约月份 */
  getOptionEtfMonths(cate: EtfOptionCate): Promise<EtfOptionMonths>;
  /** ETF 期权到期日合约 */
  getOptionEtfExpireDay(cate: EtfOptionCate, month: string): Promise<EtfOptionExpireDay>;
  /** ETF 期权分钟 K */
  getOptionEtfMinuteKline(code: string): Promise<OptionMinutePoint[]>;
  /** K 线 + 技术指标（MA/MACD/RSI…） */
  getKlineWithIndicators(params: {
    symbol: Symbol;
    period?: 'daily' | 'weekly' | 'monthly';
    adjust?: '' | 'qfq' | 'hfq';
    indicators?: Record<string, unknown>;
  }): Promise<Candle[]>;
  /** K 线买卖信号 */
  getKlineSignals(params: {
    symbol: Symbol;
    period?: 'daily' | 'weekly' | 'monthly';
    adjust?: '' | 'qfq' | 'hfq';
    maFast?: number;
    maSlow?: number;
  }): Promise<Array<Record<string, unknown>>>;
  /** 全市场盘口异动事件 */
  getStockChangeEvents(type?: StockChangeType): Promise<StockChangeEvent[]>;
  /** 个股盘口异动 */
  getIndividualChangeEvents(params: IndividualChangeParams): Promise<IndividualStockChangeEvent[]>;
  /** 龙虎榜个股上榜统计 */
  getDragonTigerStockStats(period?: DragonTigerPeriod): Promise<DragonTigerStockStat[]>;
  /** 基金分红列表 */
  getFundDividendList(params?: FundDividendListParams): Promise<FundDividendRecord[]>;
  /** 基金同类排名走势 */
  getFundRankHistory(symbol: Symbol): Promise<FundRankHistoryResult>;
  /** 盘口大单占比 */
  getLargeOrderRatios(symbols: Symbol[]): Promise<LargeOrderRatio[]>;
  /** 集合竞价快照（fuyao） */
  getAuctionSnapshot(params: AuctionSnapshotParams): Promise<AuctionSnapshot[]>;
  /** 短线风向标（fuyao） */
  getShortTermBenchmark(date?: string): Promise<ShortTermBenchmark[]>;
  /** 市场交易状态（盘前/连续竞价/午休/盘后/休市） */
  getMarketStatus(market?: Market): Promise<MarketSessionStatus>;

  // ---------- 分时（统一入口，按 Symbol.exchange 分源） ----------
  getIntraday(params: IntradayParams): Promise<IntradayPoint[]>;

  // ---------- A/H 溢价 / 新股 / 日历 ----------
  getAHPremium(params?: { [k: string]: unknown }): Promise<AHPremiumItem[]>;
  getStockNewStock(params?: { [k: string]: unknown }): Promise<StockNewStockItem[]>;
  getStockAH(params?: { [k: string]: unknown }): Promise<StockAHItem[]>;
  getStockTradingCalendar(params?: { [k: string]: unknown }): Promise<TradingCalendarItem[]>;

  // ---------- 大宗交易 ----------
  getBlockTrade(params: { code?: string; [k: string]: unknown }): Promise<BlockTradeItem[]>;

  // ---------- 基金扩展（核心基金接口之外的独有能力） ----------
  getFundList(params?: { type?: string; page?: number; size?: number }): Promise<FundListItem[]>;
  getFundRank(params: { type?: string; field?: string; [k: string]: unknown }): Promise<FundRankItem[]>;
  getFundValuation(params: { code: string; [k: string]: unknown }): Promise<FundValuation>;
  getFundBonus(params: { code: string; [k: string]: unknown }): Promise<FundBonusItem[]>;
  getFundAsset(params: { code: string; [k: string]: unknown }): Promise<FundAssetItem[]>;
  getFundManager(params: { code: string; [k: string]: unknown }): Promise<FundManagerItem[]>;
  getFundNewFund(params?: { [k: string]: unknown }): Promise<FundNewFundItem[]>;
  getFundReits(params?: { [k: string]: unknown }): Promise<FundReitsItem[]>;
  getFundTrades(params?: { [k: string]: unknown }): Promise<FundTradeItem[]>;
  getFundStock(params: { code: string; [k: string]: unknown }): Promise<FundStockItem[]>;
  getFundFinancing(params?: { [k: string]: unknown }): Promise<FundFinancingItem[]>;
  getFundPerformance(params?: { [k: string]: unknown }): Promise<FundPerformanceItem[]>;
  getFundReference(params?: { [k: string]: unknown }): Promise<FundReferenceItem[]>;
  getFundTheme(params?: { [k: string]: unknown }): Promise<FundThemeItem[]>;
  getFundShare(params: { code: string; [k: string]: unknown }): Promise<FundShareItem[]>;
  getFundTopics(params?: { [k: string]: unknown }): Promise<FundTopicItem[]>;
  getFundCategories(): Promise<FundCategory[]>;

  // ---------- 期权 ----------
  /** 期权 T 型报价（中金所股指 / 商品期权） */
  getOptionQuotes(params: OptionQuoteParams): Promise<OptionTQuoteResult>;
  /** 期权日 K（index / commodity / etf） */
  getOptionKline(params: OptionKlineParams): Promise<OptionKlineBar[]>;
  /** 中金所期权实时行情列表 */
  getOptionCffexQuotes(opts?: { pageSize?: number }): Promise<CffexOptionQuote[]>;
  /** 期权龙虎榜 */
  getOptionLhb(params: { symbol: Symbol; date: string }): Promise<OptionLhbItem[]>;

  // ---------- 期货 ----------
  /** 国内期货日/周/月 K */
  getFuturesKline(params: FuturesKlineParams): Promise<FuturesKlineBar[]>;
  /** 全球期货实时报价 */
  getFuturesGlobalSpot(opts?: { pageSize?: number }): Promise<GlobalFuturesQuote[]>;
  /** 全球期货历史 K */
  getFuturesGlobalKline(params: FuturesKlineParams): Promise<FuturesKlineBar[]>;
  /** 期货库存品种列表 */
  getFuturesInventorySymbols(): Promise<FuturesInventorySymbol[]>;
  /** 期货库存 */
  getFuturesInventory(params: FuturesInventoryParams): Promise<FuturesInventoryPoint[]>;
  /** COMEX 库存（金/银） */
  getFuturesComexInventory(params: { metal: 'gold' | 'silver'; startMs?: number; endMs?: number }): Promise<ComexInventoryPoint[]>;

  // ---------- 北向资金 ----------
  getNorthboundMinute(direction?: NorthboundDirection): Promise<NorthboundMinutePoint[]>;
  getNorthboundSummary(): Promise<NorthboundFlowSummaryItem[]>;
  getNorthboundHoldingRank(params?: NorthboundHoldingRankParams): Promise<NorthboundHoldingItem[]>;
  getNorthboundHistory(params?: NorthboundHistoryParams): Promise<NorthboundHistoryPoint[]>;
  getNorthboundIndividual(params: NorthboundIndividualParams): Promise<NorthboundIndividualPoint[]>;

  // ---------- 筹码分布 ----------
  getChipDistribution(params: ChipDistributionParams): Promise<ChipDistributionPoint[]>;

  // ---------- 融资融券 ----------
  getMarginAccountInfo(): Promise<MarginAccountStat[]>;
  getMarginTargetList(date?: string): Promise<MarginTargetStat[]>;

  // ---------- 概念板块 ----------
  getConceptBoards(params?: ConceptBoardParams): Promise<ConceptBoardItem[]>;
  getConceptBoardConstituents(symbol: Symbol): Promise<ConceptBoardConstituentItem[]>;
  getConceptBoardKline(params: ConceptBoardKlineParams): Promise<Candle[]>;
}

// ============================================================
// 派生类型：方法名 / 参数 / 返回
// ============================================================

/** 核心方法名联合（34 个） */
export type DataSourceCoreMethod = keyof DataSourceCoreMethods;

/** 扩展方法名联合（与核心不相交） */
export type DataSourceExtendedMethod = keyof DataSourceExtendedMethods;

/** 全部数据源方法名 */
export type DataSourceMethod = DataSourceCoreMethod | DataSourceExtendedMethod;

/**
 * 方法 M 的参数元组（编译期校验调用参数）。
 * 例：MethodArgs<'getKline'> = [params: KlineParams]
 */
export type MethodArgs<M extends DataSourceMethod> = M extends DataSourceCoreMethod
  ? Parameters<DataSourceCoreMethods[M]>
  : M extends DataSourceExtendedMethod
    ? Parameters<DataSourceExtendedMethods[M]>
    : never;

/**
 * 方法 M 的返回值（已解 Promise，保证 invoke 不产生双重 Promise）。
 * 例：MethodResult<'getKline'> = Candle[]；MethodResult<'getFundProfile'> = FundProfile
 */
export type MethodResult<M extends DataSourceMethod> = M extends DataSourceCoreMethod
  ? Awaited<ReturnType<DataSourceCoreMethods[M]>>
  : M extends DataSourceExtendedMethod
    ? Awaited<ReturnType<DataSourceExtendedMethods[M]>>
    : never;

/**
 * 方法 M 的「批量元素」类型：首参是数组时取数组元素，否则取首参本身。
 * 例：MethodItem<'getQuotes'> = Symbol；MethodItem<'search'> = SearchParams
 * （partition 拆分批量请求用；无首参的方法为 never，不应用于 partition）
 */
export type MethodItem<M extends DataSourceMethod> = MethodArgs<M> extends [infer F, ...unknown[]]
  ? F extends readonly (infer I)[]
    ? I
    : F
  : never;

/**
 * 方法 M 的结果行类型：返回是数组时取数组元素，否则取返回本身。
 * 例：MethodRow<'getQuotes'> = Quote；MethodRow<'getFundProfile'> = FundProfile
 * （partition 合并结果用）
 */
export type MethodRow<M extends DataSourceMethod> = MethodResult<M> extends readonly (infer R)[]
  ? R
  : MethodResult<M>;
