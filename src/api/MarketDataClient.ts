/**
 * MarketDataClient —— APP 唯一数据访问点。
 *
 * 设计理念：APP 只有一个数据访问点，它会根据已接入的多个「行情源」能力（互补）
 * 提供统一的行情 / 财务 / 基金 / 特色数据服务。各行情源按「优先级」依次提供服务：
 *   同花顺(hithsa) > stock-sdk > stock-api > fund-api（基金类由 fund-api 兜底）。
 *
 * 这个类只做「编排 / 调度 / 屏蔽差异」，不关心任何具体协议实现。所有实际能力由
 * MarketDataSource 子类（sources/*.ts）封装，保证「每个 package 提供的 api 能力
 * 都被完整覆盖」。
 *
 * 能力裁剪规则（resolveOrder）：
 *   1. 方法级支持矩阵（SUPPORT_MATRIX）：哪些源原生支持某方法，避免无意义的请求；
 *   2. 参数级裁剪（supports）：例如同花顺仅支持 A 股日/周 K，港股/美股/月K 自动跳过；
 *   3. 盘口特殊处理：sdk 提供真实盘口，api 仅空盘口兜底，故 getOrderBook 重排为
 *      sdk 优先于 api。
 */
import { createSource, hasSource, listAvailableSources } from './DataSourceRegistry';
import type { MarketDataSource } from './MarketDataSource';
import { defaultApiConfig, getApiConfig, setApiConfig } from './config';
import { HithsaHttpClient } from './sources/HithsaHttpClient';
import type {
  Symbol,
  Quote,
  Candle,
  OrderBook,
  StockInfo,
  FinancialReport,
  ProfitForecast,
  KlineParams,
  SearchResult,
  IndexKlineParams,
  QuotesParams,
  UsQuotesParams,
  HkQuotesParams,
  NewsItem,
  AnnouncementItem,
  MainForceItem,
  HotItem,
  BlockTradeItem,
  HolderItem,
  LargestHolderItem,
  HolderChangeItem,
  TopListItem,
  LimitUpDownItem,
  DragonTigerItem,
  TimeSharingItem,
  UsTimeSharingItem,
  TimeSharingParams,
  UsKlineParams,
  HkKlineParams,
  StockNewStockItem,
  StockAHItem,
  TradingCalendarItem,
  FundsFlowingItem,
  HotIndustryItem,
  TodaySurgeItem,
  IndustryBoardItem,
  IndustryFundsFlowingItem,
  LimitUpPoolItem,
  AHPremiumItem,
  FundListItem,
  FundInfo,
  FundHistoryItem,
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
  IncomeStatement,
  BalanceSheet,
  CashFlowStatement,
  FinancialIndicator,
  AdjustmentFactor,
  Valuation,
  IndexInfo,
  IndexConstituent,
  FundProfile,
  FundHolding,
  FundNav,
  FundReturn,
  FundHolder,
  AnomalyStock,
  HotStock,
  DragonTigerList,
  TradingDay,
  HistoricalFinancialParams,
  IndicatorsParams,
  IndexTag,
  FundType,
  SearchParams,
  LimitUpStock,
  ListResult,
} from './types';

/** 运行时注入的源工厂（便于测试替换） */
export type SourceFactory = (id: string) => MarketDataSource;

/** 方法级原生支持矩阵：标注每个源**原生**是否具备该能力 */
const SUPPORT_MATRIX: Record<string, string[]> = {
  // —— 核心通用 ——
  search: ['hithsa', 'stock-sdk'],
  getQuotes: ['hithsa', 'stock-sdk', 'stock-api'],
  getKline: ['hithsa', 'stock-sdk', 'stock-api'],
  getOrderBook: ['stock-sdk', 'stock-api'],
  getIndexKline: ['stock-sdk', 'stock-api'],
  getFinancials: ['hithsa', 'stock-api'],
  getProfitForecast: ['hithsa'],
  // —— 港股 / 美股行情 ——
  getUsQuotes: ['stock-api'],
  getHkQuotes: ['stock-api'],
  // —— fund-api 基金全系 ——
  getFundList: ['fund-api'],
  getFundInfo: ['fund-api'],
  getFundHistory: ['fund-api'],
  getFundRank: ['fund-api'],
  getFundValuation: ['fund-api'],
  getFundBonus: ['fund-api'],
  getFundAsset: ['fund-api'],
  getFundManager: ['fund-api'],
  getFundNewFund: ['fund-api'],
  getFundReits: ['fund-api'],
  getFundTrades: ['fund-api'],
  getFundStock: ['fund-api'],
  getFundFinancing: ['fund-api'],
  getFundPerformance: ['fund-api'],
  getFundReference: ['fund-api'],
  getFundTheme: ['fund-api'],
  getFundShare: ['fund-api'],
  getFundTopics: ['fund-api'],
  getFundCategories: ['fund-api'],
  // —— 资讯 / 公告 ——
  getBlockTrade: ['stock-sdk'],
  getNews: ['stock-sdk'],
  getHKNews: ['stock-sdk'],
  getFinanceNews: ['stock-sdk'],
  getAnnouncement: ['stock-sdk'],
  // —— 资金流 / 排行 ——
  getMainForce: ['stock-sdk'],
  getMarketHot: ['stock-sdk'],
  getStockHot: ['stock-sdk'],
  // —— 个股档案 ——
  getStockInfo: ['stock-sdk'],
  getHolders: ['stock-sdk'],
  getLargestHolders: ['stock-sdk'],
  getHolderChanges: ['stock-sdk'],
  getTopList: ['stock-sdk'],
  // —— 涨停 / 跌停 / 龙虎榜 ——
  getStockLimitUp: ['stock-sdk'],
  getStockLimitDown: ['stock-sdk'],
  getStockLimitUpList: ['stock-sdk'],
  getStockLimitDownList: ['stock-sdk'],
  getDragonTiger: ['stock-sdk'],
  // —— 分时 ——
  getStockTimeSharing: ['stock-sdk'],
  getUsTimeSharing: ['stock-sdk'],
  getTimeSharing: ['stock-sdk'],
  // —— 美股 / 港股 K线 ——
  getUsKline: ['stock-sdk'],
  getHkKline: ['stock-sdk'],
  // —— A/H 溢价 / 新股 ——
  getAHPremium: ['stock-sdk'],
  getStockNewStock: ['stock-sdk'],
  getStockAH: ['stock-sdk'],
  // —— 交易日历 / 资金流 ——
  getStockTradingCalendar: ['stock-api'],
  getStockFundsFlowing: ['stock-api', 'stock-sdk'],
  getStockHotIndustry: ['stock-api'],
  getStockTodaySurge: ['stock-api'],
  getStockIndustryBoard: ['stock-sdk'],
  getStockIndustryFundsFlowing: ['stock-sdk'],
  getStockLimitUpPool: ['stock-sdk'],
};

/** 不参与「默认兜底优先级」的方法：这些方法只由固定源提供（如基金类仅 fund-api） */
function isExclusive(method: string): boolean {
  return method.startsWith('getFund') || method === 'getHkQuotes' || method === 'getUsQuotes';
}

export interface ClientOptions {
  /** 自定义源工厂（测试用）；不传则使用 registry 的 createSource */
  sourceFactory?: SourceFactory;
}

export class MarketDataClient {
  private factory: SourceFactory;

  constructor(opts: ClientOptions = {}) {
    if (opts.sourceFactory) {
      this.factory = opts.sourceFactory;
    } else {
      this.factory = (id: string) => {
        if (!hasSource(id)) throw new Error(`no registered data source: ${id}`);
        return createSource(id);
      };
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 能力编排核心
  // ──────────────────────────────────────────────────────────────

  /**
   * 解析某次调用的「源尝试顺序」。
   *  - 基金 / 港股 / 美股 类：仅由对应专属源提供（exclusive）；
   *  - 其余：按配置 primary > fallback/extraFallbacks 顺序，再根据 SUPPORT_MATRIX 裁剪；
   *  - getOrderBook 特殊处理：sdk 真实盘口优先于 api（api 仅空盘口兜底）。
   */
  resolveOrder(method: keyof typeof SUPPORT_MATRIX, args: unknown[]): string[] {
    const cfg = getApiConfig();
    const fallbacks = [cfg.primary, cfg.fallback, ...cfg.extraFallbacks].filter((v): v is string => Boolean(v));

    if (isExclusive(method as string)) {
      return (SUPPORT_MATRIX[method as string] ?? []).slice();
    }

    let order = fallbacks.filter((id) => (SUPPORT_MATRIX[method as string] ?? []).includes(id));

    // 盘口：sdk 真实优先，api 仅兜底
    if (method === 'getOrderBook' && order.includes('stock-sdk') && order.includes('stock-api')) {
      order = ['stock-sdk', 'stock-api'];
    }
    return order;
  }

  /** 依次尝试各源，返回第一个成功结果；全部失败抛出聚合错误 */
  private async runWithFallback<T>(method: keyof typeof SUPPORT_MATRIX, ...args: unknown[]): Promise<T> {
    const order = this.resolveOrder(method, args);
    if (order.length === 0) {
      throw new Error(`no data source supports "${method}"`);
    }
    const errors: Record<string, unknown> = {};
    for (const id of order) {
      const src = this.factory(id);
      if (!src) continue;
      // 参数级裁剪：源声明不支持当前参数（如同花顺仅支持 A 股 K）时跳过
      try {
        if (typeof (src as any).supports === 'function' && !(src as any).supports(method as string, args)) {
          continue;
        }
      } catch {
        /* supports 报错视为支持，继续 */
      }
      try {
        const res = await (src as any)[method](...args);
        if (res === undefined || res === null) {
          errors[id] = new Error(`${id}.${method} returned empty`);
          continue;
        }
        return res as T;
      } catch (e) {
        errors[id] = e;
      }
    }
    const detail = order.map((id) => `${id}: ${errors[id] instanceof Error ? errors[id]!.message : String(errors[id])}`).join('; ');
    throw new Error(`all data sources failed for "${method}": ${detail}`);
  }

  // ──────────────────────────────────────────────────────────────
  // 核心通用能力
  // ──────────────────────────────────────────────────────────────

  async search(query: string): Promise<SearchResult[]> {
    return this.runWithFallback<SearchResult[]>('search', query);
  }

  /** 行情快照。兼容两种入参：{ symbols } 或直接的 Symbol[]。 */
  async getQuotes(params: QuotesParams | Symbol[]): Promise<Quote[]> {
    const p: QuotesParams = Array.isArray(params) ? { symbols: params } : params;
    return this.runWithFallback<Quote[]>('getQuotes', p);
  }

  async getKline(params: KlineParams): Promise<Candle[]> {
    return this.runWithFallback<Candle[]>('getKline', params);
  }

  async getOrderBook(symbol: Symbol): Promise<OrderBook> {
    return this.runWithFallback<OrderBook>('getOrderBook', symbol);
  }

  async getIndexKline(params: IndexKlineParams): Promise<Candle[]> {
    return this.runWithFallback<Candle[]>('getIndexKline', params);
  }

  async getFinancials(code: string): Promise<FinancialReport[]> {
    return this.runWithFallback<FinancialReport[]>('getFinancials', code);
  }

  async getProfitForecast(code: string): Promise<ProfitForecast> {
    return this.runWithFallback<ProfitForecast>('getProfitForecast', code);
  }

  // ──────────────────────────────────────────────────────────────
  // 港股 / 美股行情
  // ──────────────────────────────────────────────────────────────

  async getUsQuotes(params: UsQuotesParams): Promise<Quote[]> {
    return this.runWithFallback<Quote[]>('getUsQuotes', params);
  }

  async getHkQuotes(params: HkQuotesParams): Promise<Quote[]> {
    return this.runWithFallback<Quote[]>('getHkQuotes', params);
  }

  // ──────────────────────────────────────────────────────────────
  // fund-api 基金全系（exclusive，仅 fund-api）
  // ──────────────────────────────────────────────────────────────

  async getFundList(params?: { type?: string; page?: number; size?: number }): Promise<FundListItem[]> {
    return this.runWithFallback<FundListItem[]>('getFundList', params);
  }
  async getFundInfo(code: string): Promise<FundInfo> {
    return this.runWithFallback<FundInfo>('getFundInfo', code);
  }
  async getFundHistory(params: { code: string; start?: string; end?: string; period?: string; [k: string]: unknown }): Promise<FundHistoryItem[]> {
    return this.runWithFallback<FundHistoryItem[]>('getFundHistory', params);
  }
  async getFundRank(params: { type?: string; field?: string; [k: string]: unknown }): Promise<FundRankItem[]> {
    return this.runWithFallback<FundRankItem[]>('getFundRank', params);
  }
  async getFundValuation(params: { code: string; [k: string]: unknown }): Promise<FundValuation> {
    return this.runWithFallback<FundValuation>('getFundValuation', params);
  }
  async getFundBonus(params: { code: string; [k: string]: unknown }): Promise<FundBonusItem[]> {
    return this.runWithFallback<FundBonusItem[]>('getFundBonus', params);
  }
  async getFundAsset(params: { code: string; [k: string]: unknown }): Promise<FundAssetItem[]> {
    return this.runWithFallback<FundAssetItem[]>('getFundAsset', params);
  }
  async getFundManager(params: { code: string; [k: string]: unknown }): Promise<FundManagerItem[]> {
    return this.runWithFallback<FundManagerItem[]>('getFundManager', params);
  }
  async getFundNewFund(params?: { [k: string]: unknown }): Promise<FundNewFundItem[]> {
    return this.runWithFallback<FundNewFundItem[]>('getFundNewFund', params);
  }
  async getFundReits(params?: { [k: string]: unknown }): Promise<FundReitsItem[]> {
    return this.runWithFallback<FundReitsItem[]>('getFundReits', params);
  }
  async getFundTrades(params?: { [k: string]: unknown }): Promise<FundTradeItem[]> {
    return this.runWithFallback<FundTradeItem[]>('getFundTrades', params);
  }
  async getFundStock(params: { code: string; [k: string]: unknown }): Promise<FundStockItem[]> {
    return this.runWithFallback<FundStockItem[]>('getFundStock', params);
  }
  async getFundFinancing(params?: { [k: string]: unknown }): Promise<FundFinancingItem[]> {
    return this.runWithFallback<FundFinancingItem[]>('getFundFinancing', params);
  }
  async getFundPerformance(params?: { [k: string]: unknown }): Promise<FundPerformanceItem[]> {
    return this.runWithFallback<FundPerformanceItem[]>('getFundPerformance', params);
  }
  async getFundReference(params?: { [k: string]: unknown }): Promise<FundReferenceItem[]> {
    return this.runWithFallback<FundReferenceItem[]>('getFundReference', params);
  }
  async getFundTheme(params?: { [k: string]: unknown }): Promise<FundThemeItem[]> {
    return this.runWithFallback<FundThemeItem[]>('getFundTheme', params);
  }
  async getFundShare(params: { code: string; [k: string]: unknown }): Promise<FundShareItem[]> {
    return this.runWithFallback<FundShareItem[]>('getFundShare', params);
  }
  async getFundTopics(params?: { [k: string]: unknown }): Promise<FundTopicItem[]> {
    return this.runWithFallback<FundTopicItem[]>('getFundTopics', params);
  }
  async getFundCategories(): Promise<FundCategory[]> {
    return this.runWithFallback<FundCategory[]>('getFundCategories');
  }

  // ──────────────────────────────────────────────────────────────
  // 资讯 / 公告（stock-sdk）
  // ──────────────────────────────────────────────────────────────

  async getBlockTrade(params: { code?: string; [k: string]: unknown }): Promise<BlockTradeItem[]> {
    return this.runWithFallback<BlockTradeItem[]>('getBlockTrade', params);
  }
  async getNews(params: { [k: string]: unknown }): Promise<NewsItem[]> {
    return this.runWithFallback<NewsItem[]>('getNews', params);
  }
  async getHKNews(params: { [k: string]: unknown }): Promise<NewsItem[]> {
    return this.runWithFallback<NewsItem[]>('getHKNews', params);
  }
  async getFinanceNews(params: { [k: string]: unknown }): Promise<NewsItem[]> {
    return this.runWithFallback<NewsItem[]>('getFinanceNews', params);
  }
  async getAnnouncement(params: { code?: string; [k: string]: unknown }): Promise<AnnouncementItem[]> {
    return this.runWithFallback<AnnouncementItem[]>('getAnnouncement', params);
  }

  // ──────────────────────────────────────────────────────────────
  // 资金流 / 排行（stock-sdk / stock-api）
  // ──────────────────────────────────────────────────────────────

  async getMainForce(params: { code: string; [k: string]: unknown }): Promise<MainForceItem[]> {
    return this.runWithFallback<MainForceItem[]>('getMainForce', params);
  }
  async getMarketHot(params?: { [k: string]: unknown }): Promise<HotItem[]> {
    return this.runWithFallback<HotItem[]>('getMarketHot', params);
  }
  async getStockHot(params?: { [k: string]: unknown }): Promise<HotItem[]> {
    return this.runWithFallback<HotItem[]>('getStockHot', params);
  }

  // ──────────────────────────────────────────────────────────────
  // 个股档案 / 股东 / 龙虎榜（stock-sdk）
  // ──────────────────────────────────────────────────────────────

  async getStockInfo(code: string): Promise<StockInfo> {
    return this.runWithFallback<StockInfo>('getStockInfo', code);
  }
  async getHolders(params: { code: string; [k: string]: unknown }): Promise<HolderItem[]> {
    return this.runWithFallback<HolderItem[]>('getHolders', params);
  }
  async getLargestHolders(params: { code: string; [k: string]: unknown }): Promise<LargestHolderItem[]> {
    return this.runWithFallback<LargestHolderItem[]>('getLargestHolders', params);
  }
  async getHolderChanges(params: { code: string; [k: string]: unknown }): Promise<HolderChangeItem[]> {
    return this.runWithFallback<HolderChangeItem[]>('getHolderChanges', params);
  }
  async getTopList(params: { [k: string]: unknown }): Promise<TopListItem[]> {
    return this.runWithFallback<TopListItem[]>('getTopList', params);
  }

  // ──────────────────────────────────────────────────────────────
  // 涨停 / 跌停 / 龙虎榜（stock-sdk）
  // ──────────────────────────────────────────────────────────────

  async getStockLimitUp(params?: { [k: string]: unknown }): Promise<LimitUpDownItem[]> {
    return this.runWithFallback<LimitUpDownItem[]>('getStockLimitUp', params);
  }
  async getStockLimitDown(params?: { [k: string]: unknown }): Promise<LimitUpDownItem[]> {
    return this.runWithFallback<LimitUpDownItem[]>('getStockLimitDown', params);
  }
  async getStockLimitUpList(params?: { [k: string]: unknown }): Promise<LimitUpDownItem[]> {
    return this.runWithFallback<LimitUpDownItem[]>('getStockLimitUpList', params);
  }
  async getStockLimitDownList(params?: { [k: string]: unknown }): Promise<LimitUpDownItem[]> {
    return this.runWithFallback<LimitUpDownItem[]>('getStockLimitDownList', params);
  }
  async getDragonTiger(params?: { [k: string]: unknown }): Promise<DragonTigerItem[]> {
    return this.runWithFallback<DragonTigerItem[]>('getDragonTiger', params);
  }

  // ──────────────────────────────────────────────────────────────
  // 分时（stock-sdk）
  // ──────────────────────────────────────────────────────────────

  async getStockTimeSharing(params: { code: string; [k: string]: unknown }): Promise<TimeSharingItem[]> {
    return this.runWithFallback<TimeSharingItem[]>('getStockTimeSharing', params);
  }
  async getUsTimeSharing(params: { code: string; [k: string]: unknown }): Promise<UsTimeSharingItem[]> {
    return this.runWithFallback<UsTimeSharingItem[]>('getUsTimeSharing', params);
  }
  async getTimeSharing(params: TimeSharingParams): Promise<TimeSharingItem[]> {
    return this.runWithFallback<TimeSharingItem[]>('getTimeSharing', params);
  }

  // ──────────────────────────────────────────────────────────────
  // 美股 / 港股 K线（stock-sdk）
  // ──────────────────────────────────────────────────────────────

  async getUsKline(params: UsKlineParams): Promise<Candle[]> {
    return this.runWithFallback<Candle[]>('getUsKline', params);
  }
  async getHkKline(params: HkKlineParams): Promise<Candle[]> {
    return this.runWithFallback<Candle[]>('getHkKline', params);
  }

  // ──────────────────────────────────────────────────────────────
  // A/H 溢价 / 新股 / 日历 / 资金流（stock-sdk / stock-api）
  // ──────────────────────────────────────────────────────────────

  async getAHPremium(params?: { [k: string]: unknown }): Promise<AHPremiumItem[]> {
    return this.runWithFallback<AHPremiumItem[]>('getAHPremium', params);
  }
  async getStockNewStock(params?: { [k: string]: unknown }): Promise<StockNewStockItem[]> {
    return this.runWithFallback<StockNewStockItem[]>('getStockNewStock', params);
  }
  async getStockAH(params?: { [k: string]: unknown }): Promise<StockAHItem[]> {
    return this.runWithFallback<StockAHItem[]>('getStockAH', params);
  }
  async getStockTradingCalendar(params?: { [k: string]: unknown }): Promise<TradingCalendarItem[]> {
    return this.runWithFallback<TradingCalendarItem[]>('getStockTradingCalendar', params);
  }
  async getStockFundsFlowing(params: { [k: string]: unknown }): Promise<FundsFlowingItem[]> {
    return this.runWithFallback<FundsFlowingItem[]>('getStockFundsFlowing', params);
  }
  async getStockHotIndustry(params?: { [k: string]: unknown }): Promise<HotIndustryItem[]> {
    return this.runWithFallback<HotIndustryItem[]>('getStockHotIndustry', params);
  }
  async getStockTodaySurge(params?: { [k: string]: unknown }): Promise<TodaySurgeItem[]> {
    return this.runWithFallback<TodaySurgeItem[]>('getStockTodaySurge', params);
  }
  async getStockIndustryBoard(params?: { [k: string]: unknown }): Promise<IndustryBoardItem[]> {
    return this.runWithFallback<IndustryBoardItem[]>('getStockIndustryBoard', params);
  }
  async getStockIndustryFundsFlowing(params?: { [k: string]: unknown }): Promise<IndustryFundsFlowingItem[]> {
    return this.runWithFallback<IndustryFundsFlowingItem[]>('getStockIndustryFundsFlowing', params);
  }
  async getStockLimitUpPool(params?: { [k: string]: unknown }): Promise<LimitUpPoolItem[]> {
    return this.runWithFallback<LimitUpPoolItem[]>('getStockLimitUpPool', params);
  }

  // ──────────────────────────────────────────────────────────────
  // 同花顺(hithsa) 专属深度能力（财务三表 / 估值 / 指数 / 基金 / 异动 / 龙虎榜 / 交易日历）
  // 这些方法仅主源 hithsa 提供，直接透传。
  // ──────────────────────────────────────────────────────────────

  private hithsa(): MarketDataSource {
    return this.factory('hithsa');
  }

  /** 复权因子（hithsa 专属） */
  async getAdjustmentFactors(symbol: Symbol, from?: string, to?: string): Promise<AdjustmentFactor[]> {
    return this.hithsa().getAdjustmentFactors(symbol, from, to);
  }
  /** 估值指标（hithsa 专属） */
  async getValuations(symbols: Symbol[]): Promise<Valuation[]> {
    return this.hithsa().getValuations(symbols);
  }
  /** 利润表（hithsa 专属） */
  async getIncomeStatements(params: HistoricalFinancialParams): Promise<IncomeStatement[]> {
    return this.hithsa().getIncomeStatements(params);
  }
  /** 资产负债表（hithsa 专属） */
  async getBalanceSheets(params: HistoricalFinancialParams): Promise<BalanceSheet[]> {
    return this.hithsa().getBalanceSheets(params);
  }
  /** 现金流量表（hithsa 专属） */
  async getCashFlowStatements(params: HistoricalFinancialParams): Promise<CashFlowStatement[]> {
    return this.hithsa().getCashFlowStatements(params);
  }
  /** 财务指标（hithsa 专属） */
  async getFinancialIndicators(params: IndicatorsParams): Promise<FinancialIndicator[]> {
    return this.hithsa().getFinancialIndicators(params);
  }
  /** 指数列表（hithsa 专属） */
  async listIndices(tag?: IndexTag): Promise<IndexInfo[]> {
    return this.hithsa().listIndices(tag);
  }
  /** 指数成分（hithsa 专属） */
  async getIndexConstituents(symbol: Symbol): Promise<IndexConstituent[]> {
    return this.hithsa().getIndexConstituents(symbol);
  }
  /** 基金档案（hithsa 专属） */
  async getFundProfile(symbol: Symbol, fundType: FundType): Promise<FundProfile> {
    return this.hithsa().getFundProfile(symbol, fundType);
  }
  /** 基金持仓（hithsa 专属） */
  async getFundHoldings(symbol: Symbol, fundType: FundType): Promise<FundHolding[]> {
    return this.hithsa().getFundHoldings(symbol, fundType);
  }
  /** 基金净值（hithsa 专属） */
  async getFundNav(symbol: Symbol, fundType: FundType, range?: string): Promise<FundNav[]> {
    return this.hithsa().getFundNav(symbol, fundType, range);
  }
  /** 基金收益（hithsa 专属） */
  async getFundReturns(symbol: Symbol, fundType: FundType): Promise<FundReturn> {
    return this.hithsa().getFundReturns(symbol, fundType);
  }
  /** 基金份额持有人（hithsa 专属） */
  async getFundHolders(symbol: Symbol, fundType: FundType, mergeScope?: string): Promise<FundHolder[]> {
    return this.hithsa().getFundHolders(symbol, fundType, mergeScope);
  }
  /** 基金实时快照（hithsa 专属） */
  async getFundMarketSnapshot(symbol: Symbol): Promise<Quote> {
    return this.hithsa().getFundMarketSnapshot(symbol);
  }
  /** 基金历史K（hithsa 专属） */
  async getFundHistorical(symbol: Symbol, startMs: number, endMs: number): Promise<Candle[]> {
    return this.hithsa().getFundHistorical(symbol, startMs, endMs);
  }
  /** 涨停池（hithsa 专属，深度版） */
  async getLimitUpPool(opts?: { dateMs?: number; page?: number; size?: number; sortField?: string; sortDir?: string }): Promise<ListResult<LimitUpStock>> {
    return this.hithsa().getLimitUpPool(opts);
  }
  /** 涨停梯队（hithsa 专属） */
  async getLimitUpLadder(): Promise<unknown> {
    return this.hithsa().getLimitUpLadder();
  }
  /** 异动列表（hithsa 专属） */
  async getAnomalyList(tagCodes?: string[]): Promise<AnomalyStock[]> {
    return this.hithsa().getAnomalyList(tagCodes);
  }
  /** 个股异动（hithsa 专属） */
  async getAnomalyByStocks(symbols: Symbol[]): Promise<AnomalyStock[]> {
    return this.hithsa().getAnomalyByStocks(symbols);
  }
  /** 飙升榜（hithsa 专属） */
  async getSkyrocketList(period?: 'day' | 'hour'): Promise<HotStock[]> {
    return this.hithsa().getSkyrocketList(period);
  }
  /** 热度榜（hithsa 专属） */
  async getHotStockList(period?: 'day' | 'hour'): Promise<HotStock[]> {
    return this.hithsa().getHotStockList(period);
  }
  /** 热度榜历史（hithsa 专属） */
  async getHotStockListHistory(date: string): Promise<HotStock[]> {
    return this.hithsa().getHotStockListHistory(date);
  }
  /** 个股热度趋势（hithsa 专属） */
  async getHotStockRankTrend(symbol: Symbol, startDate: string, endDate: string): Promise<HotStock[]> {
    return this.hithsa().getHotStockRankTrend(symbol, startDate, endDate);
  }
  /** 龙虎榜（hithsa 专属，深度版） */
  async getDragonTigerList(opts?: { boardType?: string; date?: string }): Promise<DragonTigerList> {
    return this.hithsa().getDragonTigerList(opts);
  }
  /** 交易日历（hithsa 专属） */
  async getTradingDays(): Promise<TradingDay[]> {
    return this.hithsa().getTradingDays();
  }

  // ──────────────────────────────────────────────────────────────
  // 向后兼容层（适配旧 consumer 既有的便捷调用形态）
  //  - 业务层既有代码使用 getQuotes(Symbol[]) / search({keyword}) / getIndexQuotes / 缓存清理 等；
  //  - 这里全部以「薄适配」方式映射到上面的统一能力，不引入新逻辑。
  // ──────────────────────────────────────────────────────────────

  /** 兼容：直接传 Symbol[]（等价于 getQuotes({ symbols })） */
  async getQuotesArray(symbols: Symbol[]): Promise<Quote[]> {
    return this.getQuotes({ symbols });
  }

  /** 兼容：单只行情 getQuote(code) */
  async getQuote(code: string): Promise<Quote | undefined> {
    const list = await this.getQuotes({ symbols: [{ code, exchange: code.startsWith('6') ? 'SH' : 'SZ' } as Symbol] });
    return list[0];
  }

  /** 兼容：getBatchQuotes(symbols) */
  async getBatchQuotes(symbols: Symbol[]): Promise<Quote[]> {
    return this.getQuotes({ symbols });
  }

  /** 兼容：search 接受 string 或 { keyword } */
  async searchFlex(q: string | { keyword: string }): Promise<SearchResult[]> {
    const query = typeof q === 'string' ? q : q.keyword;
    return this.search(query);
  }

  /** 兼容：指数行情快照（旧 MockMarketDataClient.getIndexQuotes） */
  async getIndexQuotes(symbols: Symbol[]): Promise<Quote[]> {
    // 指数行情优先取主源；无端点时回退为空
    try {
      return await this.getQuotes({ symbols });
    } catch {
      return [];
    }
  }

  /** 当前主源 id（兼容 activeSourceId 读取） */
  get activeSourceId(): string {
    return getApiConfig().primary;
  }

  /** 列出已注册源（兼容 listSources） */
  listSources() {
    return listAvailableSources();
  }

  /** 切换主源（兼容 setPreferredSource） */
  setPreferredSource(id: string): void {
    setApiConfig({ ...getApiConfig(), primary: id });
  }

  /** 设置 API Key（兼容 setApiKey；统一收敛到同花顺 HttpClient） */
  setApiKey(key: string): void {
    HithsaHttpClient.setDefaultKey(key);
  }

  /** 回灌用户偏好（兼容 applyUserPreferences） */
  applyUserPreferences(key?: string): Promise<void> {
    if (key) HithsaHttpClient.setDefaultKey(key);
    return Promise.resolve();
  }

  /** 兼容：清理本地 K 线缓存（新模式无本地缓存，空操作） */
  pruneKlineCache(): Promise<void> {
    return Promise.resolve();
  }

  /** 兼容：清理本地行情缓存（新模式无本地缓存，空操作） */
  pruneQuotesCache(): Promise<void> {
    return Promise.resolve();
  }
}

/** 默认单例（按配置自动接入已注册源） */
let _defaultClient: MarketDataClient | null = null;
export function getDefaultClient(): MarketDataClient {
  if (!_defaultClient) _defaultClient = new MarketDataClient();
  return _defaultClient;
}

/** APP 全局唯一访问点，业务层统一从这里取数：import { marketData } from '@/api' */
export const marketData: MarketDataClient = new MarketDataClient();

export { defaultApiConfig };
