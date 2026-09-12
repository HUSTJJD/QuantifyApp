/**
 * StockSdkSource —— 基于 npm 包 `stock-sdk` 的数据源实现（备选 / 兜底行情源）。
 *
 * 角色定位：补齐同花顺官方 REST（hithsa）覆盖不到的能力，详见 MarketDataClient 的能力矩阵注释。
 * stock-sdk 是纯 TS 实现、浏览器 / Node 双端可跑，且对新老行情接口做了归一，是本 App 港股 / 美股
 * / 基金 / 板块 / 特色数据（涨停池、盘口异动、龙虎榜、北向、资金流、筹码分布等）能力的实际来源。
 *
 * 本文件对 stock-sdk v2 暴露的全部能力做统一封装（基于 sdk-Cd0dfXDL.d.ts 真实 API）：
 *  - 实时行情：quotes.cn/hk/us/fund、batch.cn/hk/us/byCodes、codes.cn/us/hk/fund
 *  - 历史 K 线：kline.cn/hk/us（日/周/月）、kline.cnMinute/hkMinute/usMinute（1/5/15/30/60 分钟）
 *  - 当日分时：quotes.timeline（仅 A 股）
 *  - 指标 / 信号：kline.withIndicators、kline.signals
 *  - 筹码分布：chips.cn/hk/us
 *  - 板块：board.industry.* / board.concept.*
 *  - 资金流向：fundFlow.individual/market/rank/sectorRank/sectorHistory
 *  - 沪深港通 / 北向：northbound.minute/summary/holdingRank/history/individual
 *  - 涨停 / 盘口异动：marketEvent.ztPool/stockChanges/boardChanges/individualChanges/individualChangesHistory
 *  - 龙虎榜：dragonTiger.detail/stockStats/institution/branchRank/seatDetail
 *  - 大宗交易：blockTrade.marketStat/detail/dailyStat
 *  - 融资融券：margin.accountInfo/targetList
 *  - 公募基金：fund.dividendList/navHistory/rankHistory/profile/theme
 *  - 交易日历 / 市场状态：calendar.isTradingDay/nextTradingDay/prevTradingDay/marketStatus
 *  - 参考数据：reference.dividendDetail/tradingCalendar
 *  - 标的检索：search
 *
 * 范围说明（与 skill 服务边界一致）：港股 / 美股 / 分钟级 / 盘口 / 指数 / 基金 / 特色数据等属于
 * 同花顺金融数据服务「超出范围」的能力，即便由本源补充，也须向用户明确说明非官方口径。
 *
 * 设计要点：
 *  - 实现 MarketDataSource 全部接口；SDK 确实不支持的能力（如三张财务报表、选股 / 回测、逐笔成交、
 *    港股美股当日分时、热股历史 / 排名趋势）才抛 3004 交由上层路由到主源（hithsa）；
 *  - 额外的 SDK 专属能力以独立公开方法暴露（如 getKlineHK / getMinuteKlineCN / getChipsHK …），
 *    供上层在明确「非同花顺官方口径」的场景下直接调用；
 *  - 所有调用统一经 guard 包裹，失败时抛出可重试分类的 DataSourceError。
 *
 * stock-sdk v2 真实 API（实例 getter 命名空间）：
 *  - sdk.quotes.cn([code]) / sdk.quotes.hk([code]) / sdk.quotes.us([code]) / sdk.quotes.fund([code])
 *  - sdk.kline.cn(code, { period:'daily'|'weekly'|'monthly', adjust:'qfq'|'hfq'|'', startDate, endDate })
 *  - sdk.kline.cnMinute(code, { period:'1'|'5'|'15'|'30'|'60', startDate, endDate })
 *  - code 形如 '600519' / '00700'（无交易所前缀、无点号）
 */
import { StockSDK, type RequestClientOptions } from 'stock-sdk';
import { DataSourceError } from '../MarketDataSource';
import type { DataSourceMethod, MethodArgs } from '../MarketDataSource';
import { BaseMarketDataSource } from './BaseMarketDataSource';
import type {
  AdjustmentFactor,
  AnomalyStock,
  Candle,
  DragonTigerList,
  DragonTigerStock,
  FundHolder,
  FundHolding,
  FundNav,
  FundNavRange,
  FundNavType,
  FundMergeScope,
  FundProfile,
  FundReturn,
  FundType,
  HistoricalFinancialParams,
  HotStock,
  IndicatorsParams,
  IndexConstituent,
  IndexInfo,
  IndexTag,
  IndustryBoardItem,
  IntradayParams,
  IntradayPoint,
  Instrument,
  KlineParams,
  LadderBoardKey,
  LadderDay,
  LadderStock,
  LimitUpLadder,
  LimitUpStock,
  ListResult,
  OrderBook,
  Quote,
  SearchParams,
  Symbol,
  TradingDay,
  Valuation,
  Exchange,
  AssetType,
  FundsFlowingItem,
  FundsFlowingParams,
  HotIndustryItem,
  IndustryBoardParams,
  IndustryBoardConstituentItem,
  IndustryBoardKlineParams,
  IndustryFundsFlowingItem,
  IndustryFundsFlowingParams,
  MainForceItem,
  TodaySurgeItem,
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
  DragonTigerStockStat,
  EtfOptionCate,
  EtfOptionExpireDay,
  EtfOptionMonths,
  FundDividendListParams,
  FundDividendRecord,
  FundRankHistoryResult,
  IndividualChangeParams,
  IndividualStockChangeEvent,
  LargeOrderRatio,
  Market,
  MarketFundFlowPoint,
  MarketSessionStatus,
  OptionMinutePoint,
  SectorFundFlowHistoryParams,
  SectorFundFlowPoint,
  StockChangeEvent,
  StockChangeType,
  CffexOptionQuote,
  ChipDistributionParams,
  ChipDistributionPoint,
  ConceptBoardConstituentItem,
  ConceptBoardItem,
  ConceptBoardKlineParams,
  ConceptBoardParams,
  ComexInventoryPoint,
  FuturesInventoryParams,
  FuturesInventoryPoint,
  FuturesInventorySymbol,
  FuturesKlineBar,
  FuturesKlineParams,
  GlobalFuturesQuote,
  MarginAccountStat,
  MarginTargetStat,
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
} from '../types';
import { register } from '../DataSourceRegistry';
import { cleanCandles } from '../candleValidity';
import { isIndexSymbol } from '@/domain/symbol';

const SOURCE_ID = 'stock-sdk';

/** 本 App 的 Symbol 转成 stock-sdk 裸代码（如 600519 / 00700） */
function toSdkCode(symbol: Symbol): string {
  return symbol.code;
}

/** 本源不支持的能力统一抛错（code 3004），便于上层回退到主源 */
function unsupported(method: string): never {
  throw new DataSourceError(`stock-sdk 不支持 ${method}`, SOURCE_ID, 3004);
}

/** 把任意数值字段安全地转 number（空值 / 非法返回 0） */
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 可空数值，缺失返回 null（遵循空值语义：绝不补零） */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 股票代码 -> Exchange（用于构造统一 Symbol） */
function exchangeOf(market: string, code: string): Symbol['exchange'] {
  if (market === 'HK') return 'HK';
  if (market === 'US') return 'US';
  // 已带 sh/sz/hk 前缀
  const c = String(code ?? '').toLowerCase();
  if (c.startsWith('hk')) return 'HK';
  if (c.startsWith('us')) return 'US';
  if (c.startsWith('sh')) return 'SH';
  if (c.startsWith('sz')) return 'SZ';
  if (c.startsWith('bj')) return 'BJ';
  // A 股按代码首位推断
  if (code.startsWith('6')) return 'SH';
  if (code.startsWith('0') || code.startsWith('3')) return 'SZ';
  if (code.startsWith('8') || code.startsWith('4') || code.startsWith('92')) return 'BJ';
  return 'SH';
}

/** 期权 T 型报价腿映射 */
function mapOptionLeg(it: any): OptionTQuoteResult['calls'][number] {
  return {
    symbol: String(it?.symbol ?? ''),
    buyVolume: numOrNull(it?.buyVolume),
    buyPrice: numOrNull(it?.buyPrice),
    price: numOrNull(it?.price),
    askPrice: numOrNull(it?.askPrice),
    askVolume: numOrNull(it?.askVolume),
    openInterest: numOrNull(it?.openInterest),
    change: numOrNull(it?.change),
    strikePrice: numOrNull(it?.strikePrice),
  };
}

function mapOptionTQuote(raw: any): OptionTQuoteResult {
  return {
    calls: (raw?.calls ?? []).map(mapOptionLeg),
    puts: (raw?.puts ?? []).map(mapOptionLeg),
  };
}

/** 期货 K 线统一映射 */
function mapFuturesKline(raw: any[]): FuturesKlineBar[] {
  return (raw ?? []).map((it: any) => ({
    date: String(it?.date ?? ''),
    code: String(it?.code ?? ''),
    name: String(it?.name ?? ''),
    open: numOrNull(it?.open),
    high: numOrNull(it?.high),
    low: numOrNull(it?.low),
    close: numOrNull(it?.close),
    volume: numOrNull(it?.volume),
    amount: numOrNull(it?.amount),
    changePct: numOrNull(it?.changePercent),
    change: numOrNull(it?.change),
    openInterest: numOrNull(it?.openInterest),
  }));
}

export class StockSdkSource extends BaseMarketDataSource {
  readonly id = SOURCE_ID;
  readonly label = 'StockSDK';

  /**
   * stock-sdk 覆盖的能力（A股/港股/美股行情、K线、盘口、基金净值、涨停池、板块指数、龙虎榜、交易日历等）。
   * 强类型：只能是 DataSourceMethod 中定义的方法名。
   * 此前声明的 33 个扩展方法（新闻/资金流/股东/分时/美股港股等）SDK 无对应端点、
   * 实现体一律抛 3004，声明只会让路由器白白尝试一次，故移除——未声明者 SourceRouter 直接跳过。
   */
  readonly capabilities: ReadonlySet<DataSourceMethod> = new Set([
    'listTickers', 'search', 'getQuotes', 'getKline', 'getOrderBook', 'getAdjustmentFactors',
    'getValuations', 'listIndices', 'getIndexConstituents', 'getIndexQuotes', 'getIndexKline',
    'getFundProfile', 'getFundHoldings', 'getFundNav', 'getFundReturns', 'getFundHolders',
    'getFundMarketSnapshot', 'getFundHistorical',
    'getLimitUpPool', 'getLimitUpLadder', 'getAnomalyList', 'getAnomalyByStocks',
    'getSkyrocketList', 'getHotStockList', 'getDragonTigerList', 'getTradingDays',
    // 本源自带 BK 板块体系（list + spot 带涨跌幅/成交额），补录进统一契约
    'getStockIndustryBoard',
    // 当日分时：quotes.timeline（仅 A 股；HK/US 方法体 3004）
    'getIntraday',
    // P0-B 能力缺口（期权/期货/北向/筹码/两融/概念板块）—— 本源为唯一覆盖源
    'getOptionQuotes', 'getOptionKline', 'getOptionCffexQuotes', 'getOptionLhb',
    'getFuturesKline', 'getFuturesGlobalSpot', 'getFuturesGlobalKline',
    'getFuturesInventorySymbols', 'getFuturesInventory', 'getFuturesComexInventory',
    'getNorthboundMinute', 'getNorthboundSummary', 'getNorthboundHoldingRank',
    'getNorthboundHistory', 'getNorthboundIndividual',
    'getChipDistribution',
    'getMarginAccountInfo', 'getMarginTargetList',
    'getConceptBoards', 'getConceptBoardConstituents', 'getConceptBoardKline',
    // P1-A：资金流 / 板块行情 / 今日异动（stock-sdk fundFlow + marketEvent）
    'getMainForce', 'getStockFundsFlowing', 'getStockHotIndustry',
    'getStockIndustryFundsFlowing', 'getStockTodaySurge',
    // P1-B：行业板块细分 / 龙虎榜细分 / 大宗统计 / 日历状态 / 分红
    'getIndustryBoardConstituents', 'getIndustryBoardKline', 'getSectorFundFlowHistory',
    'getDragonTigerInstitution', 'getDragonTigerBranchRank', 'getDragonTigerSeatDetail',
    'getBlockTradeMarketStat', 'getBlockTradeDailyStat',
    'isTradingDay', 'nextTradingDay', 'prevTradingDay',
    'getDividendDetail',
    // P2 闭环补录
    'getMarketFundFlow', 'getOptionEtfMonths', 'getOptionEtfExpireDay', 'getOptionEtfMinuteKline',
    'getKlineWithIndicators', 'getKlineSignals', 'getStockChangeEvents', 'getIndividualChangeEvents',
    'getDragonTigerStockStats', 'getFundDividendList', 'getFundRankHistory', 'getLargeOrderRatios',
    'getMarketStatus',
  ]);

  private static _instance: StockSdkSource | null = null;
  static getInstance(): StockSdkSource {
    if (!this._instance) this._instance = new StockSdkSource();
    return this._instance;
  }

  private _sdk: StockSDK | null = null;
  private _options?: RequestClientOptions;

  /** 复用单一 SDK 实例（避免每次调用都 new），类型直接来自 stock-sdk 包 */
  private get sdk(): StockSDK {
    if (!this._sdk) this._sdk = new StockSDK({ ...this._options });
    return this._sdk;
  }

  /**
   * 注入 stock-sdk 运行配置（超时 / 重试 / baseUrl 等），可选。
   * 上层可在注册本源时通过 init(options) 传入，未传则使用 SDK 默认配置。
   */
  async init(options?: RequestClientOptions): Promise<void> {
    this._options = options;
    this._sdk = new StockSDK({ ...options });
  }
  async dispose(): Promise<void> {}

  /**
   * 参数级能力裁剪（兜底源默认支持绝大多数组合，仅对明确不支持的参数返回 false）：
   *  - getIndexConstituents：仅支持 stock-sdk 板块码（BK + 数字）；
   *  - getIndexQuotes / getIndexKline：同花顺板块指数（.TI）不属于本源覆盖体系；
   *  - 其余方法默认支持；方法级裁剪已由 capabilities 完成。
   * 方法体内对同样规则有守卫（抛 3004，双保险）；supports 供路由器先行裁剪，避免无谓尝试。
   */
  supports<M extends DataSourceMethod>(method: M, args: MethodArgs<M>): boolean {
    // 动态分发边界 cast：参数类型已按方法签名（MethodArgs）校验，运行时统一按未类型化数组读取
    const a = args as unknown[];
    if (method === 'getIndexConstituents') {
      const s = a[0] as Symbol | undefined;
      // stock-sdk 板块码格式固定为 BK + 数字（如 BK1027），非此格式 → 不属于本源
      if (!s || !/^BK\d+$/.test(toSdkCode(s))) return false;
    }
    if (method === 'getIndexQuotes') {
      const syms = a[0] as Symbol[] | undefined;
      // 本源只覆盖东财 BK/EM 板块；真实股指与同花顺 TI 指数交给 hithsa/fuyao
      if (!syms || syms.length === 0) return false;
      const hasBoard = syms.some((s) => s.exchange === 'EM' || /^BK\d+$/i.test(s.code));
      return hasBoard;
    }
    if (method === 'getIndexKline') {
      const p = a[0] as KlineParams | undefined;
      if (!p) return false;
      // 东财板块（EM/BK）走 board.*，本源覆盖
      if (p.symbol.exchange === 'EM' || /^BK\d+$/i.test(p.symbol.code)) return true;
      // TI 同花顺板块指数不走本源
      if (p.symbol.exchange === 'TI') return false;
      // 真实股指（000xxx.SH / 399xxx.SZ）交给 hithsa/fuyao
      if (/^000\d{3}$/.test(p.symbol.code) || /^399\d{3}$/.test(p.symbol.code)) {
        return false;
      }
      return true;
    }
    // 通用部分委托基类引擎（本源无参数级 spec = 不限制）
    return super.supports(method, args);
  }

  /** 统一错误包裹：保留已有的 DataSourceError，否则包装为可重试错误 */
  private guard<T>(p: Promise<T>, msg: string): Promise<T> {
    return p.catch((e: unknown) => {
      if (e instanceof DataSourceError) throw e;
      throw new DataSourceError(msg, SOURCE_ID, undefined, e);
    });
  }

  // ============================================================
  // 一、MarketDataSource 接口实现（统一契约，供 MarketDataClient 调度）
  // ============================================================

  // ---------- 元信息 ----------
  /**
   * 标的检索：委托 SDK 的 search（支持 A股 / 港股 / 美股 / 指数 / 基金 模糊搜索）。
   * 港股 / 美股标的是本兜底源的重点能力，主源不支持时会路由到这里。
   */
  async search(params: SearchParams): Promise<Instrument[]> {
    const kw = params.keyword?.trim();
    if (!kw) return [];
    const raw: any[] = await this.guard(this.sdk.search(kw), '标的检索失败');
    let items = (raw ?? []).map((r: any) => mapInstrument(r));
    if (params.limit && params.limit > 0) items = items.slice(0, params.limit);
    return items;
  }

  /** 全量 A 股代码表：SDK 原生支持 sdk.codes.cn() */
  async listTickers(_opts?: {
    exchange?: Exchange;
    assetType?: AssetType;
    limit?: number;
    offset?: number;
  }): Promise<Instrument[]> {
    const codes: string[] = await this.guard(this.sdk.codes.cn(), 'A股代码表失败');
    return (codes ?? []).map((code: string) => ({
      symbol: { code, exchange: exchangeOf('CN', code) },
      name: '',
      market: 'A' as const,
      assetType: 'a-share' as const,
    }));
  }

  // ---------- 行情 ----------
  /**
   * 批量实时行情快照：按市场分组分别调用 cn / hk / us / fund。
   * 这是 StockSdkSource 作为兜底源的核心能力（覆盖港股 / 美股 / 基金）。
   */
  async getQuotes(symbols: Symbol[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];
    const groups: Record<'cn' | 'hk' | 'us' | 'fund', Symbol[]> = { cn: [], hk: [], us: [], fund: [] };
    for (const s of symbols) {
      if (s.exchange === 'HK') groups.hk.push(s);
      else if (s.exchange === 'US' || s.exchange === 'TI') groups.us.push(s);
      else if (s.exchange === 'OF') groups.fund.push(s);
      else groups.cn.push(s);
    }

    // 分市场独立拉取：单个市场（如 cn）失败不应拖垮整批，hk/us/fund 仍可按兜底源正常返回。
    // 仅当「所有市场」都失败时，才整体抛出聚合错误（避免混合自选里一只 A 股接口抖动就导致港股/美股行情全失败）。
    const nsList: Array<'cn' | 'hk' | 'us' | 'fund'> = ['cn', 'hk', 'us', 'fund'];
    const out: Quote[] = [];
    const failures: string[] = [];
    for (const ns of nsList) {
      const syms = groups[ns];
      if (syms.length === 0) continue;
      try {
        const codes = syms.map(toSdkCode);
        const raw: any[] = await this.guard<any[]>(this.sdk.quotes[ns](codes), `${ns.toUpperCase()} 行情失败`);
        // 代码匹配：精确 code → 数值归一（HK 00700/700）→ 位置对齐
        const byCode = new Map<string, any>();
        for (const r of raw ?? []) {
          const c = String(r?.code ?? '');
          if (c) byCode.set(c, r);
        }
        const list = raw ?? [];
        syms.forEach((s, i) => {
          const code = codes[i];
          let r: any = byCode.get(code);
          if (r == null) {
            // HK/US 代码可能去前导零或格式不同：按数值等价再匹配一次
            const norm = String(Number(code));
            for (const [k, v] of byCode) {
              if (String(Number(k)) === norm) {
                r = v;
                break;
              }
            }
          }
          if (r == null && list.length === syms.length) r = list[i];
          // 查无有效价：跳过，绝不伪造 0 价快照（0 价会让上层误判为有效行情）
          if (r == null) return;
          const lastRaw = r.price ?? r.last ?? r.nav;
          if (lastRaw == null || !Number.isFinite(Number(lastRaw))) return;
          out.push(ns === 'fund' ? mapFundQuote(s, r) : mapQuote(s, r));
        });
      } catch (e) {
        // SDK 原生 DataSourceError（如 3004 不支持）直接透传，遵循「不掩盖」契约；
        // 仅把本源 guard 包装的（sourceId === SOURCE_ID，多为网络/抖动）视为可隔离的失败，记录后继续其它市场。
        if (e instanceof DataSourceError && e.sourceId !== SOURCE_ID) throw e;
        // 透出根因（guard 包装前的原始错误），便于定位 stock-sdk 真实失败原因（网络/鉴权/超时/字段异常等）
        const reason = e instanceof Error ? e.message : String(e);
        const causeMsg =
          e instanceof DataSourceError && e.cause instanceof Error ? ` -> ${e.cause.message}` : '';
        failures.push(`${ns.toUpperCase()}: ${reason}${causeMsg}`);
      }
    }
    if (out.length === 0 && failures.length > 0) {
      throw new DataSourceError(`getQuotes 全市场失败: ${failures.join('; ')}`, SOURCE_ID);
    }
    return out;
  }

  /**
   * 五档盘口：仅 A 股 FullQuote 含 bid/ask 五档；港股 / 美股 Quote 类型在本 SDK 版本未返回盘口，
   * 如实返回空盘口（绝不伪造数据）。ETF 场内基金 FundQuote 也无盘口。
   */
  async getOrderBook(symbol: Symbol): Promise<OrderBook> {
    // 港股/美股/场内基金无五档：空盘口
    if (symbol.exchange === 'HK' || symbol.exchange === 'US' || symbol.exchange === 'OF') {
      return { symbol, bids: [], asks: [], updatedAt: Date.now() };
    }
    try {
      const raw: any[] = await this.guard(this.sdk.quotes.cn([toSdkCode(symbol)]), '盘口失败');
      const r: any = (raw ?? [])[0] ?? {};
      const bids = (r.bid ?? []).map((b: any) => ({ price: num(b.price), volume: num(b.volume) }));
      const asks = (r.ask ?? []).map((a: any) => ({ price: num(a.price), volume: num(a.volume) }));
      return { symbol, bids, asks, updatedAt: numOrNull(r.timestamp) ?? Date.now() };
    } catch {
      // 上游盘口端点不稳定/无数据：返回空盘口，避免个股详情刷红屏
      return { symbol, bids: [], asks: [], updatedAt: Date.now() };
    }
  }

  /**
   * 历史 K 线：日 / 周 / 月走 kline.cn/hk/us（daily/weekly/monthly）；
   * 分钟级（1m~60m）走 kline.cnMinute/hkMinute/usMinute。
   */
  async getKline(params: KlineParams): Promise<Candle[]> {
    const code = toSdkCode(params.symbol);

    // 东方财富板块指数代码（行业/概念，如 BK0475）不是个股：按个股 K 线接口（kline.cn）拿不到数据，
    // 必须走板块专用接口 board.industry/concept.kline|minuteKline（见 boardKlineCN）。
    if (/^BK\d{3,5}$/i.test(code)) {
      return this.boardKlineCN(code, params);
    }

    const adjustMap: Record<string, '' | 'qfq' | 'hfq'> = { none: '', forward: 'qfq', backward: 'hfq' };
    const adjust = adjustMap[params.adjust ?? 'none'] ?? '';
    const opts: any = { adjust };
    if (params.startMs) opts.startDate = fmtDate(params.startMs);
    if (params.endMs) opts.endDate = fmtDate(params.endMs);
    if (params.count) opts.limit = params.count;

    const isMinute = ['1m', '5m', '15m', '30m', '60m'].includes(params.period);
    if (isMinute) {
      const periodMap: Record<string, '1' | '5' | '15' | '30' | '60'> = {
        '1m': '1',
        '5m': '5',
        '15m': '15',
        '30m': '30',
        '60m': '60',
      };
      const ns =
        params.symbol.exchange === 'HK'
          ? 'hkMinute'
          : params.symbol.exchange === 'US'
            ? 'usMinute'
            : 'cnMinute';
      const raw: any[] = await this.guard(
        this.sdk.kline[ns](code, { ...opts, period: periodMap[params.period] }),
        `分钟K线失败(${params.symbol.exchange}.${code} ${params.period})`,
      );
      return cleanCandles(mapMinuteKline(raw ?? []));
    }

    const periodMap: Record<string, 'daily' | 'weekly' | 'monthly'> = {
      day: 'daily',
      week: 'weekly',
      month: 'monthly',
    };
    const ns = params.symbol.exchange === 'HK' ? 'hk' : params.symbol.exchange === 'US' ? 'us' : 'cn';
    // 港股：kline.hk 对空 adjust 敏感，默认 qfq；失败一律降级空数组
    if (params.symbol.exchange === 'HK') {
      const hkAdjust: '' | 'qfq' | 'hfq' =
        params.adjust === 'backward' ? 'hfq' : params.adjust === 'forward' ? 'qfq' : 'qfq';
      try {
        const raw = await this.sdk.kline.hk(code, {
          period: periodMap[params.period],
          adjust: hkAdjust,
          ...(params.count ? { limit: params.count } : {}),
        });
        return cleanCandles(
          (raw ?? []).map((it: any) => ({
            datetime: it.date,
            open: num(it.open),
            high: num(it.high),
            low: num(it.low),
            close: num(it.close),
            volume: num(it.volume),
            amount: it.amount != null ? num(it.amount) : undefined,
          })),
        );
      } catch {
        return [];
      }
    }
    try {
      const raw: any[] = await this.guard(
        this.sdk.kline[ns](code, { ...opts, period: periodMap[params.period] }),
        `K线失败(${params.symbol.exchange}.${code} ${params.period})`,
      );
      return cleanCandles(
        (raw ?? []).map((it: any) => ({
          datetime: it.date,
          open: num(it.open),
          high: num(it.high),
          low: num(it.low),
          close: num(it.close),
          volume: num(it.volume),
          amount: it.amount != null ? num(it.amount) : undefined,
        })),
      );
    } catch (e) {
      // 北交所 / 场内基金(ETF/LOF) / 期权 / 债券等在 cn 端点常无数据：降级为空
      if (
        params.symbol.exchange === 'BJ' ||
        params.symbol.exchange === 'OF' ||
        !/^\d+$/.test(code) ||
        /^1[012]\d{4,8}$/.test(code) ||
        /^5\d{5}$/.test(code) ||
        /^(15|16|18)\d{4}$/.test(code)
      ) {
        return [];
      }
      throw e;
    }
  }

  /**
   * 板块指数（BKxxxx）K 线：走东方财富板块专用接口。
   * 行业/概念共用 BK 代码段，无法静态区分，因此先试行业、无结果再试概念；
   * 两者都无数据视为「该板块无 K 线」返回空（不抛错），两者都出错才抛错交由上层路由。
   */
  private async boardKlineCN(code: string, params: KlineParams): Promise<Candle[]> {
    const opts: any = { adjust: '' };
    if (params.startMs) opts.startDate = fmtDate(params.startMs);
    if (params.endMs) opts.endDate = fmtDate(params.endMs);
    if (params.count) opts.limit = params.count;

    const attempts: Array<() => Promise<unknown[]>> = [];
    if (['1m', '5m', '15m', '30m', '60m'].includes(params.period)) {
      const minute: Record<string, '1' | '5' | '15' | '30' | '60'> = {
        '1m': '1',
        '5m': '5',
        '15m': '15',
        '30m': '30',
        '60m': '60',
      };
      const mOpts = { period: minute[params.period] };
      attempts.push(() => this.getIndustryMinuteKline(code, mOpts));
      attempts.push(() => this.getConceptMinuteKline(code, mOpts));
    } else {
      const daily: Record<string, 'daily' | 'weekly' | 'monthly'> = {
        day: 'daily',
        week: 'weekly',
        month: 'monthly',
      };
      // 直接打 SDK 原始接口（返回 SDK 字段），交给下方 mapMinuteKline 统一映射；
      // 不要走 getIndustryBoardKline（已映射成 Candle，会二次映射）
      const dOpts = {
        period: daily[params.period],
        adjust: opts.adjust,
        startDate: opts.startDate,
        endDate: opts.endDate,
      };
      attempts.push(() => this.guard(this.sdk.board.industry.kline(code, dOpts), '行业板块K线失败'));
      attempts.push(() => this.guard(this.sdk.board.concept.kline(code, dOpts), '概念板块K线失败'));
    }

    let lastErr: unknown = null;
    for (const run of attempts) {
      try {
        const candles = cleanCandles(mapMinuteKline(((await run()) ?? []) as any[]));
        if (candles.length > 0) return candles;
        // 该命名空间为空 → 尝试另一命名空间（BK 代码行业/概念不互斥，需试）
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) {
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    }
    return [];
  }

  /** 复权事件：委托 SDK reference.dividendDetail（分红 / 送转明细）。指数/板块/基金/期权无复权 → 空。 */
  async getAdjustmentFactors(symbol: Symbol, from?: string, to?: string): Promise<AdjustmentFactor[]> {
    if (
      isIndexSymbol(symbol) ||
      symbol.exchange === 'HK' ||
      symbol.exchange === 'US' ||
      symbol.exchange === 'OF' ||
      !/^\d+$/.test(symbol.code)
    ) {
      return [];
    }
    try {
      const raw: any[] = await this.guard(
        this.sdk.reference.dividendDetail(toSdkCode(symbol)),
        '复权因子失败',
      );
      let items = (raw ?? []).map((it: any) => ({
        symbol,
        ticker: String(it.code ?? symbol.code),
        exDateMs: it.date ? new Date(it.date).getTime() : 0,
        dividendPerShare: numOrNull(it.dividend) ?? 0,
        perShareBonus: numOrNull(it.bonus) ?? 0,
      }));
      if (from) items = items.filter((i) => i.exDateMs >= new Date(from).getTime());
      if (to) items = items.filter((i) => i.exDateMs <= new Date(to).getTime());
      return items;
    } catch {
      return [];
    }
  }

  /** 估值：A 股 FullQuote 自带 pe/pb 等字段 */
  async getValuations(symbols: Symbol[]): Promise<Valuation[]> {
    if (symbols.length === 0) return [];
    const cnSyms = symbols.filter((s) => s.exchange !== 'HK' && s.exchange !== 'US');
    if (cnSyms.length === 0) return symbols.map((s) => emptyValuation(s));
    const raw: any[] = await this.guard(
      this.sdk.quotes.cn(cnSyms.map(toSdkCode)),
      '估值失败',
    );
    const byCode = new Map<string, any>((raw ?? []).map((r) => [r.code ?? '', r]));
    return cnSyms.map((s) => {
      const r: any = byCode.get(toSdkCode(s)) ?? {};
      return {
        symbol: s,
        name: r.name ?? null,
        peTtm: numOrNull(r.pe),
        peMrq: numOrNull(r.peStatic),
        pbMrq: numOrNull(r.pb),
        psTtm: numOrNull(r.psTtm),
        pcfTtm: numOrNull(r.pcfTtm),
        timestamp: numOrNull(r.timestamp),
      };
    });
  }

  // ---------- 财务报表：SDK 未提供三表 / 财务指标 -> 3004 交由 hithsa ----------
  async getIncomeStatements(_params: HistoricalFinancialParams): Promise<never> {
    return unsupported('getIncomeStatements');
  }
  async getBalanceSheets(_params: HistoricalFinancialParams): Promise<never> {
    return unsupported('getBalanceSheets');
  }
  async getCashFlowStatements(_params: HistoricalFinancialParams): Promise<never> {
    return unsupported('getCashFlowStatements');
  }
  async getFinancialIndicators(_params: IndicatorsParams): Promise<never> {
    return unsupported('getFinancialIndicators');
  }

  // ---------- 指数 / 板块 ----------
  /** 板块 / 行业列表（行业板块近似为「指数」候选） */
  async listIndices(_tag?: IndexTag): Promise<IndexInfo[]> {
    const raw: any[] = await this.guard(this.sdk.board.industry.list(), '板块列表失败');
    return (raw ?? []).map((r: any) => {
      const code = String(r.code ?? '');
      // BKxxxx = 东财板块（EM），不要标成 SH/TI，否则 getIndexQuotes 会走错源
      const exchange = /^BK\d+$/i.test(code) ? ('EM' as const) : ('SH' as const);
      return {
        symbol: { code, exchange, name: r.name },
        name: String(r.name ?? ''),
      };
    });
  }

  /**
   * SDK 板块成分只覆盖本源行业板块体系（code 形如 BK1027）。
   * 真实指数（000300）与同花顺板块体系码（881xxx 等）不属于本源——对非 BK 码一律
   * 在本地按 3004 不支持静默回退到主源，绝不发请求：
   *  - 既避免“非本体系代码”被 SDK 误当故障（NOT_FOUND / NETWORK_ERROR 表现不稳定）；
   *  - 也不浪费流量；BK 码本身的真实故障仍如实上报。
   */
  async getIndexConstituents(symbol: Symbol): Promise<IndexConstituent[]> {
    const code = toSdkCode(symbol);
    // stock-sdk 板块码格式固定为 BK + 数字（如 BK1027），非此格式 → 不属于本源
    if (!/^BK\d+$/.test(code)) {
      return unsupported('getIndexConstituents');
    }
    let raw: any[];
    try {
      raw = await this.sdk.board.industry.constituents(code);
    } catch (e) {
      const err = e as { code?: string; cause?: { code?: string; message?: string } };
      const sdkCode = err.code ?? err.cause?.code;
      if (sdkCode === 'NOT_FOUND') {
        return unsupported('getIndexConstituents');
      }
      // 带上标的与 SDK 底层错误码，便于在聚合报错里直接定位（真实故障保留上报）
      throw new DataSourceError(
        `板块成分失败(${symbol.code}${sdkCode ? `|sdk:${sdkCode}` : ''})`,
        SOURCE_ID,
        undefined,
        e,
      );
    }
    return (raw ?? [])
      .map((r: any) => {
        const code = String(r.code ?? '');
        return {
          symbol: { code, exchange: exchangeOf('CN', code), name: r.name },
          name: String(r.name ?? ''),
        };
      })
      .filter((it) => {
        // 板块成分里可能混入 B 股（200/900）等，A 股行情接口不认，过滤掉避免拖垮整批 getQuotes
        return /^(60\d{4}|68\d{4}|00\d{4}|30\d{4}|8\d{4}|4\d{4}|92\d{4})$/.test(it.symbol.code);
      });
  }

  /** 指数 / 板块行情：批量行情接口可返回指数（含 sh000001 等） */
  async getIndexQuotes(symbols: Symbol[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];
    // 同花顺板块指数（88xxxx.TI）与真实股指（000001.SH 等）不走本源：
    // batch.byCodes 对股指返回空/失败，应交给 hithsa/fuyao index API
    const boards = symbols.filter((s) => s.exchange === 'EM' || /^BK\d+$/i.test(s.code));
    if (boards.length === 0) {
      return unsupported('getIndexQuotes');
    }

    const out: Quote[] = [];
    const list: any[] = await this.guard(this.sdk.board.industry.list(), '板块行情失败');
    const byCode = new Map<string, any>((list ?? []).map((b) => [String(b?.code ?? ''), b]));
    for (const s of boards) {
      const b = byCode.get(s.code);
      if (!b) continue;
      const price = numOrNull(b.price) ?? 0;
      const pct = numOrNull(b.changePercent);
      out.push({
        symbol: { ...s, name: b.name ? String(b.name) : s.name },
        last: price,
        prevClose: price && pct != null ? price / (1 + pct / 100) : 0,
        open: price,
        high: price,
        low: price,
        volume: numOrNull(b.volume) ?? 0,
        // 板块无成交额时用总市值代理（与 treemap 权重口径一致）
        amount: numOrNull(b.totalMarketCap) ?? numOrNull(b.amount) ?? 0,
        changePct: pct ?? undefined,
        updatedAt: Date.now(),
      });
    }
    return out;
  }

  async getIndexKline(params: KlineParams): Promise<Candle[]> {
    const code = params.symbol.code;
    // 东财板块（EM / BKxxxx）：走 board.industry/concept.kline，不能当个股 kline.cn
    if (params.symbol.exchange === 'EM' || /^BK\d+$/i.test(code)) {
      return this.boardKlineCN(code, params);
    }
    // 同花顺板块指数（.TI，88xxxx）不属于 stock-sdk 覆盖体系 → 3004
    if (params.symbol.exchange === 'TI') {
      return unsupported('getIndexKline');
    }
    // 真实股指：batch/kline 对 000001 等支持不稳定，交给 hithsa/fuyao
    if (params.symbol.exchange === 'SH' || params.symbol.exchange === 'SZ') {
      if (/^000/.test(code) || /^399/.test(code)) {
        return unsupported('getIndexKline');
      }
    }
    return this.getKline({ ...params, symbol: { ...params.symbol, exchange: 'SH' } });
  }

  // ---------- 基金 ----------
  async getFundProfile(symbol: Symbol, _fundType: FundType): Promise<FundProfile> {
    const r: any = await this.guard(this.sdk.fund.profile(toSdkCode(symbol)), '基金资料失败');
    const mgr = (r.managers ?? [])[0];
    return {
      symbol,
      ticker: String(r.code ?? symbol.code),
      fundName: r.name ?? null,
      estabDateMs: r.estabDate ? new Date(r.estabDate).getTime() : null,
      mgmtName: mgr?.name ?? null,
      managerName: mgr?.name ?? null,
    };
  }
  /** 前十大重仓股（来自 profile.holdings） */
  async getFundHoldings(symbol: Symbol, _fundType: FundType): Promise<FundHolding[]> {
    const r: any = await this.guard(this.sdk.fund.profile(toSdkCode(symbol)), '基金持仓失败');
    return (r.holdings ?? []).map((it: any) => ({
      symbol,
      ticker: String(it.code ?? ''),
      stockName: String(it.name ?? ''),
      holdRatio: num(it.holdRatioFloat ?? it.holdRatioTotal),
    }));
  }
  /** 历史净值（最新在前，接口返回升序，这里反转以贴合 app 习惯） */
  async getFundNav(
    symbol: Symbol,
    _fundType: FundType,
    _range?: FundNavRange,
    navType?: FundNavType,
  ): Promise<FundNav[]> {
    // stock-sdk 的 fund.navHistory 仅接受 code（一次性返回全历史）；
    // navType 决定取「单位净值」还是「累计净值」，由本地映射选择字段。
    // 统一契约 navType 对齐 fuyao：unit / adj / unit,adj
    const r: any = await this.guard(this.sdk.fund.navHistory(toSdkCode(symbol)), '基金净值失败');
    const useAcc = navType === 'adj' || navType === 'unit,adj';
    return (r.items ?? []).map((it: any) => ({
      symbol,
      navDate: String(it.date ?? ''),
      unitNav: numOrNull(useAcc ? it.accNav : it.nav),
      adjNav: numOrNull(it.accNav),
    }));
  }
  /** 阶段收益（来自 profile.stageReturns） */
  async getFundReturns(symbol: Symbol, _fundType: FundType): Promise<FundReturn> {
    const r: any = await this.guard(this.sdk.fund.profile(toSdkCode(symbol)), '基金收益失败');
    const s = r.stageReturns ?? {};
    return {
      symbol,
      returnMonth: numOrNull(s.oneMonth),
      returnTmonth: numOrNull(s.threeMonth),
      returnHyar: numOrNull(s.sixMonth),
      returnYear: numOrNull(s.oneYear),
      returnTyear: null,
      returnFyear: null,
      returnNowYear: null,
      returnNow: null,
    };
  }
  /** 持有人结构（来自 profile.holderStructure） */
  async getFundHolders(symbol: Symbol, _fundType: FundType, mergeScope?: FundMergeScope): Promise<FundHolder[]> {
    const r: any = await this.guard(this.sdk.fund.profile(toSdkCode(symbol)), '基金份额持有人失败');
    return (r.holderStructure ?? []).map((it: any) => ({
      symbol,
      mergeScope: mergeScope === 'separate' ? 'separate' : 'merged',
      reportDateMs: it.timestamp ?? new Date(it.date).getTime(),
      insPosition: numOrNull(it.institutionRatio),
      holderAmount: null,
      avgHolderShare: null,
      psnlRate: numOrNull(it.individualRatio),
      mgmtStaffHoldRate: numOrNull(it.internalRatio),
    }));
  }
  /** 场内基金实时行情 */
  async getFundMarketSnapshot(symbol: Symbol): Promise<Quote> {
    const raw: any[] = await this.guard(this.sdk.quotes.fund([toSdkCode(symbol)]), '场内基金行情失败');
    const r: any = (raw ?? [])[0] ?? {};
    return mapFundQuote(symbol, r);
  }
  /** 基金历史净值（复用 navHistory，SDK 一次性返回全历史，按区间本地截断） */
  async getFundHistorical(symbol: Symbol, _startMs: number, _endMs: number): Promise<Candle[]> {
    const r: any = await this.guard(
      this.sdk.fund.navHistory(toSdkCode(symbol)),
      '基金历史失败',
    );
    return (r.items ?? [])
      .filter((it: any) => it.nav != null)
      .map((it: any) => ({
        datetime: it.date,
        open: num(it.nav),
        high: num(it.nav),
        low: num(it.nav),
        close: num(it.nav),
        volume: 0,
        amount: undefined,
      }));
  }

  // ---------- 特色数据 ----------
  /** 涨停池：ztPool('zt', date) 返回 ZTPoolItem[] */
  async getLimitUpPool(opts?: {
    dateMs?: number;
    page?: number;
    size?: number;
    sortField?: string;
    sortDir?: string;
  }): Promise<ListResult<LimitUpStock>> {
    const date = opts?.dateMs ? fmtDate(opts.dateMs) : undefined;
    const raw: any[] = await this.guard(
      this.sdk.marketEvent.ztPool('zt', date),
      '涨停池失败',
    );
    const list: LimitUpStock[] = (raw ?? []).map((it: any) => ({
      symbol: { code: String(it.code ?? ''), exchange: exchangeOf('CN', it.code ?? ''), name: it.name },
      name: String(it.name ?? ''),
      isSt: /ST/.test(it.name ?? ''),
      isNew: false,
      lastPrice: numOrNull(it.price) ?? 0,
      changePct: numOrNull(it.changePercent) ?? 0,
      limitUpTime: String(it.firstBoardTime ?? ''),
      limitUpReason: String(it.industry ?? ''),
      continueDayText: String(it.continuousBoardCount ?? ''),
      continueDayCnt: numOrNull(it.continuousBoardCount) ?? 0,
      sealMoney: numOrNull(it.boardAmount) ?? 0,
      maxSealMoney: numOrNull(it.boardAmount) ?? 0,
    }));
    const total = list.length;
    const size = opts?.size ?? Math.max(total, 1);
    return {
      items: list,
      pagination: {
        total,
        page: opts?.page ?? 1,
        size,
        pages: Math.max(1, Math.ceil(total / size)),
      },
    };
  }
  /**
   * 连板天梯：stock-sdk 无独立天梯端点，用涨停池按连板数合成单日矩阵。
   * 与 fuyao/hithsa 的「日期→板位」结构对齐，但仅有最近一个交易日。
   */
  async getLimitUpLadder(): Promise<LimitUpLadder> {
    const pool = await this.getLimitUpPool();
    const boardKeys: LadderBoardKey[] = ['two_board', 'three_board', 'four_board', 'five_board', 'six_board', 'seven_over'];
    const boards = {} as Record<LadderBoardKey, LadderStock[]>;
    for (const k of boardKeys) boards[k] = [];
    for (const it of pool.items) {
      const n = it.continueDayCnt;
      const key: LadderBoardKey =
        n >= 7 ? 'seven_over' : n === 6 ? 'six_board' : n === 5 ? 'five_board' : n === 4 ? 'four_board' : n === 3 ? 'three_board' : 'two_board';
      if (n < 2) continue; // 1 板不属于天梯
      boards[key].push({
        symbol: it.symbol,
        name: it.name,
        boardNum: n,
        sealNextDay: null,
        signLevel: 0,
      });
    }
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const day: LadderDay = { date: today, boards };
    return {
      timestamp: Date.now(),
      window: { length: 1, dateList: [today], boardCaps: {} },
      days: [day],
    };
  }
  /** 盘口异动全量 */
  async getAnomalyList(): Promise<AnomalyStock[]> {
    const raw: any[] = await this.guard(this.sdk.marketEvent.stockChanges('all'), '异动列表失败');
    return (raw ?? []).map((it: any) => ({
      symbol: { code: String(it.code ?? ''), exchange: exchangeOf('CN', it.code ?? ''), name: it.name },
      stockName: String(it.name ?? ''),
      analysisContent: String(it.info ?? ''),
      keywordList: it.changeTypeLabel ? [it.changeTypeLabel] : [],
      tagName: String(it.changeTypeLabel ?? ''),
    }));
  }
  /** 按标的批量查询异动 */
  async getAnomalyByStocks(symbols: Symbol[]): Promise<AnomalyStock[]> {
    const all = await this.getAnomalyList();
    const codes = new Set(symbols.map(toSdkCode));
    return all.filter((a) => codes.has(a.symbol.code));
  }
  /** 飙升榜（大笔买入异动近似） */
  async getSkyrocketList(): Promise<HotStock[]> {
    const raw: any[] = await this.guard(
      this.sdk.marketEvent.stockChanges('rocket_launch'),
      '飙升榜失败',
    );
    return (raw ?? []).map((it: any) => mapHot({ code: it.code, exchange: exchangeOf('CN', it.code ?? '') }, it));
  }
  /** 热股榜：SDK 无独立热股榜，用资金流排行近似 */
  async getHotStockList(): Promise<HotStock[]> {
    const raw: any[] = await this.guard(this.sdk.fundFlow.rank({ indicator: 'today' }), '热股榜失败');
    return (raw ?? []).map((it: any, i: number) => ({
      symbol: { code: String(it.code ?? ''), exchange: exchangeOf('CN', it.code ?? ''), name: it.name },
      name: String(it.name ?? ''),
      rank: i + 1,
      heat: numOrNull(it.mainNetInflow) ?? 0,
      rankChange: 0,
      rankTrend: '',
    }));
  }
  /** 热股历史 / 排名趋势：SDK 未提供 -> 3004 */
  async getHotStockListHistory(_date: string): Promise<never> {
    return unsupported('getHotStockListHistory');
  }
  async getHotStockRankTrend(_symbol: Symbol, _startDate: string, _endDate: string): Promise<never> {
    return unsupported('getHotStockRankTrend');
  }
  /** 龙虎榜详情（按日期区间） */
  async getDragonTigerList(opts?: { boardType?: string; date?: string }): Promise<DragonTigerList> {
    const startDate = opts?.date ? opts.date.replace(/-/g, '') : undefined;
    const raw: any[] = await this.guard(
      this.sdk.dragonTiger.detail({ startDate: startDate!, endDate: startDate! }),
      '龙虎榜失败',
    );
    const stockItems: DragonTigerStock[] = (raw ?? []).map((it: any) => ({
      symbol: { code: String(it.code ?? ''), exchange: exchangeOf('CN', it.code ?? ''), name: it.name },
      name: String(it.name ?? ''),
      conceptList: [],
      change: numOrNull(it.changePercent) ?? 0,
      buyValue: numOrNull(it.buyAmount) ?? 0,
      sellValue: numOrNull(it.sellAmount) ?? 0,
      netValue: numOrNull(it.netBuyAmount) ?? 0,
      netRate: numOrNull(it.netBuyRatio) ?? 0,
      orgNetValue: 0,
      hotMoneyNetValue: 0,
      hotRank: 0,
      rangeDays: 0,
      limitReason: String(it.reason ?? ''),
    }));
    return {
      boardType: opts?.boardType ?? '',
      tradeDate: opts?.date ?? '',
      count: stockItems.length,
      stockCount: stockItems.length,
      stockItems,
      hotMoneyItems: [],
    };
  }

  // ---------- 交易日历 ----------
  async getTradingDays(): Promise<TradingDay[]> {
    const raw: string[] = await this.guard(this.sdk.reference.tradingCalendar(), '交易日历失败');
    return (raw ?? []).map((d: string) => ({
      dateMs: new Date(d).getTime(),
      date: d,
    }));
  }

  /**
   * 当日分时 —— 统一入口，仅 A 股（quotes.timeline）。
   * 港股 / 美股 SDK 本版本无当日分时 → 3004，由上层路由决策。
   *
   * ── 传输协议 ──────────────────────────
   * 上游：sdk.quotes.timeline(code) → TodayTimelineResponse
   * 批量：单标；触发：拉一次
   *
   * ── 请求 ──────────────────────────────
   * | 字段 | 类型 | 必填 | 取值 | 说明 |
   * | symbol | Symbol | 是 | 600519.SH | 仅 A 股；HK/US 抛 3004 |
   * | date | string | 否 | YYYY-MM-DD | 上游仅支持当日，非当日视为不支持 |
   *
   * ── 响应（源字段）──────────────────────
   * | data[].time | string | HH:mm | |
   * | data[].price | number | 当前价 | |
   * | data[].avgPrice | number | 均价 | |
   * | data[].volume | number | 累计成交量(股) | |
   * | data[].amount | number | 累计成交额(元) | |
   *
   * ── 映射到统一类型 ────────────────────
   * time→IntradayPoint.time；price/avgPrice/volume/amount 同名映射
   */
  async getIntraday(params: IntradayParams): Promise<IntradayPoint[]> {
    const ex = params.symbol.exchange;
    if (ex === 'HK' || ex === 'US' || ex === 'OF') {
      return unsupported(`getIntraday(${ex})`);
    }
    if (params.date) {
      const today = new Date().toISOString().slice(0, 10);
      if (params.date !== today) return unsupported(`getIntraday(date=${params.date})`);
    }
    const raw: any = await this.guard(
      this.sdk.quotes.timeline(toSdkCode(params.symbol)),
      '当日分时失败',
    );
    const rows: any[] = raw?.data ?? [];
    return rows.map((it: any) => ({
      time: String(it.time ?? ''),
      price: numOrNull(it.price) ?? 0,
      avgPrice: numOrNull(it.avgPrice),
      volume: numOrNull(it.volume),
      amount: numOrNull(it.amount),
    }));
  }

  // ---------- P1-A 资金流 / 板块 / 异动 ----------

  /**
   * 个股主力资金历史。
   * ── 上游：sdk.fundFlow.individual(code, { period })
   * ── 单位：元；mainNetInflow 为负=净流出
   */
  async getMainForce(params: { symbol: Symbol; period?: 'daily' | 'weekly' | 'monthly' }): Promise<MainForceItem[]> {
    const raw: any = await this.guard(
      this.sdk.fundFlow.individual(toSdkCode(params.symbol), { period: params.period ?? 'daily' }),
      '个股主力资金失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      date: String(it?.date ?? ''),
      close: numOrNull(it?.close),
      changePct: numOrNull(it?.changePercent),
      mainNetInflow: numOrNull(it?.mainNetInflow),
      mainNetInflowPct: numOrNull(it?.mainNetInflowPercent),
      superLargeNetInflow: numOrNull(it?.superLargeNetInflow),
      largeNetInflow: numOrNull(it?.largeNetInflow),
      mediumNetInflow: numOrNull(it?.mediumNetInflow),
      smallNetInflow: numOrNull(it?.smallNetInflow),
    }));
  }

  /** 个股资金流排行 */
  async getStockFundsFlowing(params?: FundsFlowingParams): Promise<FundsFlowingItem[]> {
    let raw: any;
    try {
      raw = await this.guard(
        this.sdk.fundFlow.rank({ indicator: params?.period ?? 'today' }),
        '个股资金流排行失败',
      );
    } catch {
      // 行情源偶发不可用：首页卡片静默降级，不刷 LogBox
      return [];
    }
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    const limit = params?.limit;
    const target = typeof limit === 'number' && limit > 0 ? rows.slice(0, limit) : rows;
    return target.map((it: any) => ({
      symbol: { code: String(it?.code ?? ''), exchange: exchangeOf('CN', it?.code ?? '') },
      name: String(it?.name ?? ''),
      price: numOrNull(it?.price),
      changePct: numOrNull(it?.changePercent),
      mainNetInflow: numOrNull(it?.mainNetInflow),
      mainNetInflowPct: numOrNull(it?.mainNetInflowPercent),
    }));
  }

  /** 板块资金流排行（行业/概念/地域） */
  async getStockIndustryFundsFlowing(params?: IndustryFundsFlowingParams): Promise<IndustryFundsFlowingItem[]> {
    let raw: any;
    try {
      raw = await this.guard(
        this.sdk.fundFlow.sectorRank({
          indicator: params?.period ?? 'today',
          sectorType: params?.sectorType,
        }),
        '板块资金流排行失败',
      );
    } catch {
      return [];
    }
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    const limit = params?.limit;
    const target = typeof limit === 'number' && limit > 0 ? rows.slice(0, limit) : rows;
    return target.map((it: any) => ({
      code: String(it?.code ?? ''),
      name: String(it?.name ?? ''),
      changePct: numOrNull(it?.changePercent),
      mainNetInflow: numOrNull(it?.mainNetInflow),
      mainNetInflowPct: numOrNull(it?.mainNetInflowPercent),
      topStockName: it?.topStockName ?? null,
      topStockCode: it?.topStockCode ?? null,
    }));
  }

  /** 热门行业：板块资金流按行业过滤的便捷别名 */
  async getStockHotIndustry(params?: IndustryFundsFlowingParams): Promise<HotIndustryItem[]> {
    const rows = await this.getStockIndustryFundsFlowing({ ...params, sectorType: 'industry' });
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      changePct: r.changePct,
      mainNetInflow: r.mainNetInflow,
    }));
  }

  /** 今日异动/飙升：marketEvent.stockChanges('rocket_launch') */
  async getStockTodaySurge(params?: { limit?: number }): Promise<TodaySurgeItem[]> {
    const raw: any = await this.guard(
      this.sdk.marketEvent.stockChanges('rocket_launch'),
      '今日异动失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    const limit = params?.limit;
    const target = typeof limit === 'number' && limit > 0 ? rows.slice(0, limit) : rows;
    return target.map((it: any) => ({
      symbol: { code: String(it?.code ?? ''), exchange: exchangeOf('CN', it?.code ?? '') },
      name: String(it?.name ?? ''),
      changeType: it?.changeTypeLabel ?? null,
      info: it?.info ?? null,
      price: numOrNull(it?.price),
      changePct: numOrNull(it?.changePercent),
    }));
  }

  // ---------- P1-B 行业板块细分 / 龙虎榜 / 大宗 / 日历 / 分红 ----------

  /** 行业板块成分股 */
  async getIndustryBoardConstituents(symbol: Symbol): Promise<IndustryBoardConstituentItem[]> {
    const raw: any = await this.guard(
      this.sdk.board.industry.constituents(toSdkCode(symbol)),
      '行业板块成分失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      symbol: { code: String(it?.code ?? ''), exchange: exchangeOf('CN', it?.code ?? '') },
      name: String(it?.name ?? ''),
      rank: it?.rank != null ? Number(it.rank) : undefined,
      price: numOrNull(it?.price),
      changePct: numOrNull(it?.changePercent),
      change: numOrNull(it?.change),
      volume: numOrNull(it?.volume),
      amount: numOrNull(it?.amount),
      turnoverRate: numOrNull(it?.turnoverRate),
      pe: numOrNull(it?.pe),
      pb: numOrNull(it?.pb),
    }));
  }

  /** 行业板块 K 线 → 统一 Candle */
  async getIndustryBoardKline(params: IndustryBoardKlineParams): Promise<Candle[]> {
    const raw: any = await this.guard(
      this.sdk.board.industry.kline(toSdkCode(params.symbol), {
        period: params.period ?? 'daily',
        adjust: params.adjust ?? '',
        startDate: params.startMs ? fmtDate(params.startMs) : undefined,
        endDate: params.endMs ? fmtDate(params.endMs) : undefined,
      }),
      '行业板块K线失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      datetime: String(it?.date ?? ''),
      open: numOrNull(it?.open) ?? 0,
      high: numOrNull(it?.high) ?? 0,
      low: numOrNull(it?.low) ?? 0,
      close: numOrNull(it?.close) ?? 0,
      volume: numOrNull(it?.volume) ?? 0,
      amount: numOrNull(it?.amount) ?? undefined,
    }));
  }

  /** 板块资金流历史（symbol 形如 BK0438） */
  async getSectorFundFlowHistory(params: SectorFundFlowHistoryParams): Promise<SectorFundFlowPoint[]> {
    const raw: any = await this.guard(
      this.sdk.fundFlow.sectorHistory(toSdkCode(params.symbol), { period: params.period ?? 'daily' }),
      '板块资金流历史失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      date: String(it?.date ?? ''),
      close: numOrNull(it?.close),
      changePct: numOrNull(it?.changePercent),
      mainNetInflow: numOrNull(it?.mainNetInflow),
      mainNetInflowPct: numOrNull(it?.mainNetInflowPercent),
      superLargeNetInflow: numOrNull(it?.superLargeNetInflow),
      largeNetInflow: numOrNull(it?.largeNetInflow),
      mediumNetInflow: numOrNull(it?.mediumNetInflow),
      smallNetInflow: numOrNull(it?.smallNetInflow),
    }));
  }

  /** 龙虎榜机构买卖（按日期区间，YYYYMMDD） */
  async getDragonTigerInstitution(params: DragonTigerInstitutionParams): Promise<DragonTigerInstitutionStat[]> {
    const raw: any = await this.guard(
      this.sdk.dragonTiger.institution({
        startDate: params.startDate.replace(/-/g, ''),
        endDate: params.endDate.replace(/-/g, ''),
      }),
      '龙虎榜机构买卖失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      symbol: { code: String(it?.code ?? ''), exchange: exchangeOf('CN', it?.code ?? '') },
      name: String(it?.name ?? ''),
      date: String(it?.date ?? ''),
      close: numOrNull(it?.close),
      changePct: numOrNull(it?.changePercent),
      buyOrgCount: numOrNull(it?.buyOrgCount),
      sellOrgCount: numOrNull(it?.sellOrgCount),
      orgBuyAmount: numOrNull(it?.orgBuyAmount),
      orgSellAmount: numOrNull(it?.orgSellAmount),
      orgNetAmount: numOrNull(it?.orgNetAmount),
    }));
  }

  /** 龙虎榜营业部排行 */
  async getDragonTigerBranchRank(period?: DragonTigerPeriod): Promise<DragonTigerBranchStat[]> {
    const raw: any = await this.guard(
      this.sdk.dragonTiger.branchRank(period),
      '龙虎榜营业部排行失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      code: String(it?.code ?? ''),
      name: String(it?.name ?? ''),
      totalBuyAmount: numOrNull(it?.totalBuyAmount),
      totalSellAmount: numOrNull(it?.totalSellAmount),
      buyCount: numOrNull(it?.buyCount),
      sellCount: numOrNull(it?.sellCount),
      totalCount: numOrNull(it?.totalCount),
    }));
  }

  /** 龙虎榜个股席位明细 */
  async getDragonTigerSeatDetail(params: DragonTigerSeatParams): Promise<DragonTigerSeat[]> {
    const raw: any = await this.guard(
      this.sdk.dragonTiger.seatDetail(toSdkCode(params.symbol), params.date.replace(/-/g, '')),
      '龙虎榜席位明细失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      rank: numOrNull(it?.rank),
      branchName: String(it?.branchName ?? ''),
      buyAmount: numOrNull(it?.buyAmount),
      buyAmountRatio: numOrNull(it?.buyAmountRatio),
      sellAmount: numOrNull(it?.sellAmount),
      sellAmountRatio: numOrNull(it?.sellAmountRatio),
      netAmount: numOrNull(it?.netAmount),
      side: it?.side === 'sell' ? ('sell' as const) : ('buy' as const),
    }));
  }

  /** 大宗交易市场统计（按日） */
  async getBlockTradeMarketStat(): Promise<BlockTradeMarketStat[]> {
    const raw: any = await this.guard(this.sdk.blockTrade.marketStat(), '大宗市场统计失败');
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      date: String(it?.date ?? ''),
      shClose: numOrNull(it?.shClose),
      shChangePct: numOrNull(it?.shChangePercent),
      totalAmount: numOrNull(it?.totalAmount),
      premiumAmount: numOrNull(it?.premiumAmount),
      premiumRatio: numOrNull(it?.premiumRatio),
      discountAmount: numOrNull(it?.discountAmount),
      discountRatio: numOrNull(it?.discountRatio),
    }));
  }

  /** 大宗交易按股日统计 */
  async getBlockTradeDailyStat(params?: BlockTradeDateParams): Promise<BlockTradeDailyStat[]> {
    const raw: any = await this.guard(
      this.sdk.blockTrade.dailyStat({
        startDate: params?.startDate ? params.startDate.replace(/-/g, '') : undefined,
        endDate: params?.endDate ? params.endDate.replace(/-/g, '') : undefined,
      }),
      '大宗日统计失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      symbol: { code: String(it?.code ?? ''), exchange: exchangeOf('CN', it?.code ?? '') },
      name: String(it?.name ?? ''),
      date: String(it?.date ?? ''),
      changePct: numOrNull(it?.changePercent),
      close: numOrNull(it?.close),
      dealCount: numOrNull(it?.dealCount),
      dealTotalAmount: numOrNull(it?.dealTotalAmount),
      dealTotalVolume: numOrNull(it?.dealTotalVolume),
      premiumAmount: numOrNull(it?.premiumAmount),
      discountAmount: numOrNull(it?.discountAmount),
    }));
  }

  /** 是否交易日（A 股） */
  async isTradingDay(date?: string): Promise<boolean> {
    return this.guard(this.sdk.calendar.isTradingDay(date), '交易日判断失败');
  }

  /** 下一交易日 */
  async nextTradingDay(date?: string): Promise<string> {
    return this.guard(this.sdk.calendar.nextTradingDay(date), '下一交易日失败');
  }

  /** 上一交易日 */
  async prevTradingDay(date?: string): Promise<string> {
    return this.guard(this.sdk.calendar.prevTradingDay(date), '上一交易日失败');
  }

  /** 分红送配明细 */
  async getDividendDetail(symbol: Symbol): Promise<DividendDetailItem[]> {
    const raw: any = await this.guard(
      this.sdk.reference.dividendDetail(toSdkCode(symbol)),
      '分红明细失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      symbol: { code: String(it?.code ?? toSdkCode(symbol)), exchange: exchangeOf('CN', it?.code ?? toSdkCode(symbol)) },
      name: String(it?.name ?? ''),
      reportDate: it?.reportDate ?? null,
      planNoticeDate: it?.planNoticeDate ?? null,
      dividendPretax: numOrNull(it?.dividendPretax),
      dividendYield: numOrNull(it?.dividendYield),
      bonusRatio: numOrNull(it?.bonusRatio),
      transferRatio: numOrNull(it?.transferRatio),
      exDividendDate: it?.exDividendDate ?? null,
      equityRecordDate: it?.equityRecordDate ?? null,
      payDate: it?.payDate ?? null,
      assignProgress: it?.assignProgress ?? null,
    }));
  }

  // ---------- P2 闭环补录 ----------

  /** 大盘资金流（按日） */
  async getMarketFundFlow(): Promise<MarketFundFlowPoint[]> {
    const raw: any = await this.guard(this.sdk.fundFlow.market(), '大盘资金流失败');
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      date: String(it?.date ?? ''),
      shClose: numOrNull(it?.shClose),
      shChangePct: numOrNull(it?.shChangePercent),
      szClose: numOrNull(it?.szClose),
      szChangePct: numOrNull(it?.szChangePercent),
      mainNetInflow: numOrNull(it?.mainNetInflow),
      mainNetInflowPct: numOrNull(it?.mainNetInflowPercent),
      superLargeNetInflow: numOrNull(it?.superLargeNetInflow),
      largeNetInflow: numOrNull(it?.largeNetInflow),
      mediumNetInflow: numOrNull(it?.mediumNetInflow),
      smallNetInflow: numOrNull(it?.smallNetInflow),
    }));
  }

  /** ETF 期权各月合约 */
  async getOptionEtfMonths(cate: EtfOptionCate): Promise<EtfOptionMonths> {
    const raw: any = await this.guard(this.sdk.options.etf.months(cate), 'ETF期权月份失败');
    return {
      months: raw?.months ?? [],
      stockId: String(raw?.stockId ?? ''),
      cateId: String(raw?.cateId ?? ''),
      cateList: raw?.cateList ?? [],
    };
  }

  /** ETF 期权到期日合约 */
  async getOptionEtfExpireDay(cate: EtfOptionCate, month: string): Promise<EtfOptionExpireDay> {
    const raw: any = await this.guard(this.sdk.options.etf.expireDay(cate, month), 'ETF期权到期日失败');
    return {
      expireDay: String(raw?.expireDay ?? ''),
      remainderDays: Number(raw?.remainderDays) || 0,
      stockId: String(raw?.stockId ?? ''),
      name: String(raw?.name ?? ''),
    };
  }

  /** ETF 期权分钟 K */
  async getOptionEtfMinuteKline(code: string): Promise<OptionMinutePoint[]> {
    const raw: any = await this.guard(this.sdk.options.etf.minute(code), 'ETF期权分钟K失败');
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      time: String(it?.time ?? ''),
      date: String(it?.date ?? ''),
      price: numOrNull(it?.price),
      volume: numOrNull(it?.volume),
      openInterest: numOrNull(it?.openInterest),
      avgPrice: numOrNull(it?.avgPrice),
    }));
  }

  /**
   * K 线 + 技术指标。SDK 在 OHLCV 上追加 ma/macd/rsi 等字段，
   * 统一契约只保证 Candle 公共字段；指标字段挂在对象上由消费方按需读取。
   */
  async getKlineWithIndicators(params: {
    symbol: Symbol;
    period?: 'daily' | 'weekly' | 'monthly';
    adjust?: '' | 'qfq' | 'hfq';
    indicators?: Record<string, unknown>;
  }): Promise<Candle[]> {
    const raw: any = await this.guard(
      this.sdk.kline.withIndicators(toSdkCode(params.symbol), {
        period: params.period ?? 'daily',
        adjust: params.adjust ?? '',
        indicators: params.indicators ?? {},
      }),
      '指标K线失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      datetime: it?.date ?? it?.datetime ?? '',
      open: numOrNull(it?.open) ?? 0,
      high: numOrNull(it?.high) ?? 0,
      low: numOrNull(it?.low) ?? 0,
      close: numOrNull(it?.close) ?? 0,
      volume: numOrNull(it?.volume) ?? 0,
      amount: numOrNull(it?.amount) ?? undefined,
    })) as Candle[];
  }

  /** K 线买卖信号（金叉/死叉等，字段随 SDK 输出透传） */
  async getKlineSignals(params: {
    symbol: Symbol;
    period?: 'daily' | 'weekly' | 'monthly';
    adjust?: '' | 'qfq' | 'hfq';
    maFast?: number;
    maSlow?: number;
  }): Promise<Array<Record<string, unknown>>> {
    const raw: any = await this.guard(
      this.sdk.kline.signals(toSdkCode(params.symbol), {
        period: params.period ?? 'daily',
        adjust: params.adjust ?? '',
        maFast: params.maFast,
        maSlow: params.maSlow,
      }),
      'K线信号失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({ ...it }));
  }

  /** 全市场盘口异动事件 */
  async getStockChangeEvents(type?: StockChangeType): Promise<StockChangeEvent[]> {
    const raw: any = await this.guard(
      this.sdk.marketEvent.stockChanges((type ?? 'all') as any),
      '盘口异动失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      time: String(it?.time ?? ''),
      symbol: { code: String(it?.code ?? ''), exchange: exchangeOf('CN', it?.code ?? '') },
      name: String(it?.name ?? ''),
      changeType: (it?.changeType ?? 'unknown') as StockChangeType,
      changeTypeLabel: String(it?.changeTypeLabel ?? ''),
      info: String(it?.info ?? ''),
    }));
  }

  /** 个股盘口异动 */
  async getIndividualChangeEvents(params: IndividualChangeParams): Promise<IndividualStockChangeEvent[]> {
    const raw: any = await this.guard(
      this.sdk.marketEvent.individualChanges(toSdkCode(params.symbol), {
        date: params.date ? params.date.replace(/-/g, '') : undefined,
      }),
      '个股异动失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      time: String(it?.time ?? ''),
      changeType: (it?.changeType ?? 'unknown') as StockChangeType,
      changeTypeLabel: String(it?.changeTypeLabel ?? ''),
      price: numOrNull(it?.price),
      changePct: numOrNull(it?.changePercent),
      info: String(it?.info ?? ''),
    }));
  }

  /** 龙虎榜个股上榜统计 */
  async getDragonTigerStockStats(period?: DragonTigerPeriod): Promise<DragonTigerStockStat[]> {
    const raw: any = await this.guard(this.sdk.dragonTiger.stockStats(period), '龙虎榜统计失败');
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      symbol: { code: String(it?.code ?? ''), exchange: exchangeOf('CN', it?.code ?? '') },
      name: String(it?.name ?? ''),
      latestDate: String(it?.latestDate ?? ''),
      close: numOrNull(it?.close),
      changePct: numOrNull(it?.changePercent),
      count: numOrNull(it?.count),
      totalBuyAmount: numOrNull(it?.totalBuyAmount),
      totalSellAmount: numOrNull(it?.totalSellAmount),
      totalNetAmount: numOrNull(it?.totalNetAmount),
      afterChange1d: numOrNull(it?.afterChange1d),
      afterChange5d: numOrNull(it?.afterChange5d),
      afterChange10d: numOrNull(it?.afterChange10d),
    }));
  }

  /** 基金分红列表 */
  async getFundDividendList(params?: FundDividendListParams): Promise<FundDividendRecord[]> {
    const raw: any = await this.guard(
      this.sdk.fund.dividendList(params ?? {}),
      '基金分红列表失败',
    );
    const items: any[] = raw?.items ?? (Array.isArray(raw) ? raw : raw?.item ?? []);
    return items.map((it: any) => ({
      code: String(it?.code ?? ''),
      name: String(it?.name ?? ''),
      equityRecordDate: it?.equityRecordDate ?? null,
      exDividendDate: it?.exDividendDate ?? null,
      dividendPerShare: numOrNull(it?.dividendPerShare),
      payDate: it?.payDate ?? null,
      dividendType: it?.dividendType ?? null,
    }));
  }

  /** 基金同类排名走势 */
  async getFundRankHistory(symbol: Symbol): Promise<FundRankHistoryResult> {
    const raw: any = await this.guard(this.sdk.fund.rankHistory(toSdkCode(symbol)), '基金排名走势失败');
    const items: any[] = raw?.items ?? [];
    return {
      code: String(raw?.code ?? toSdkCode(symbol)),
      name: raw?.name ?? null,
      items: items.map((it: any) => ({
        date: String(it?.date ?? ''),
        rank: numOrNull(it?.rank),
        total: numOrNull(it?.total),
        percentile: numOrNull(it?.percentile),
      })),
    };
  }

  /** 盘口大单占比 */
  async getLargeOrderRatios(symbols: Symbol[]): Promise<LargeOrderRatio[]> {
    if (symbols.length === 0) return [];
    const codes = symbols.map(toSdkCode);
    const raw: any = await this.guard(this.sdk.quotes.largeOrder(codes), '盘口大单失败');
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    const byCode = new Map<string, any>();
    rows.forEach((r: any) => {
      const c = String(r?.code ?? r?.symbol ?? '');
      if (c) byCode.set(c, r);
    });
    return symbols.map((s, i) => {
      const r = byCode.get(codes[i]) ?? rows[i] ?? {};
      return {
        symbol: s,
        buyLargeRatio: numOrNull(r?.buyLargeRatio),
        buySmallRatio: numOrNull(r?.buySmallRatio),
        sellLargeRatio: numOrNull(r?.sellLargeRatio),
        sellSmallRatio: numOrNull(r?.sellSmallRatio),
      };
    });
  }

  /** 市场交易状态 */
  async getMarketStatus(market?: Market): Promise<MarketSessionStatus> {
    const m = (market ?? 'A') as 'A' | 'HK' | 'US';
    return this.sdk.calendar.marketStatus(m) as MarketSessionStatus;
  }

  // ============================================================
  // P0-B 能力缺口：期权 / 期货 / 北向 / 筹码 / 两融 / 概念板块
  // ============================================================

  /**
   * 期权 T 型报价 —— 中金所股指 / 商品期权。
   *
   * ── 传输协议 ──────────────────────────
   * 上游：sdk.options.index.spot(product, contract) / sdk.options.commodity.spot(variety, contract)
   * 批量：单合约；触发：拉一次
   *
   * ── 请求 ──────────────────────────────
   * | kind | enum | 是 | index|commodity | ETF 无 T 型报价端点 |
   * | product | string | 是 | ho/io/mo 或商品品种码 | |
   * | contract | string | 是 | 合约码如 IO2409-C-3500 / CU2409C70000 | |
   *
   * ── 映射 ──────────────────────────────
   * calls/puts 原样透传为 OptionTQuoteLeg[]（字段与 SDK 一致，null=无报价）
   */
  async getOptionQuotes(params: OptionQuoteParams): Promise<OptionTQuoteResult> {
    if (params.kind === 'index') {
      const raw = await this.guard(
        this.sdk.options.index.spot(params.product as 'ho' | 'io' | 'mo', params.contract),
        '股指期权T型报价失败',
      );
      return mapOptionTQuote(raw);
    }
    const raw = await this.guard(
      this.sdk.options.commodity.spot(params.product, params.contract),
      '商品期权T型报价失败',
    );
    return mapOptionTQuote(raw);
  }

  /**
   * 期权日 K —— index / commodity / etf。
   * etf 走 options.etf.dailyKline；index/commodity 走各自 kline。
   */
  async getOptionKline(params: OptionKlineParams): Promise<OptionKlineBar[]> {
    let raw: any[];
    if (params.kind === 'etf') {
      raw = await this.guard(this.sdk.options.etf.dailyKline(params.code), 'ETF期权日K失败');
    } else if (params.kind === 'index') {
      raw = await this.guard(this.sdk.options.index.kline(params.code), '股指期权日K失败');
    } else {
      raw = await this.guard(this.sdk.options.commodity.kline(params.code), '商品期权日K失败');
    }
    return (raw ?? []).map((it: any) => ({
      date: String(it.date ?? ''),
      open: numOrNull(it.open),
      high: numOrNull(it.high),
      low: numOrNull(it.low),
      close: numOrNull(it.close),
      volume: numOrNull(it.volume),
    }));
  }

  /** 中金所期权实时行情列表（SDK 仅支持 pageSize，产品过滤由上层自行处理） */
  async getOptionCffexQuotes(opts?: { pageSize?: number }): Promise<CffexOptionQuote[]> {
    const raw: any[] = await this.guard(
      this.sdk.options.cffex.quotes(opts?.pageSize ? { pageSize: opts.pageSize } : undefined),
      '中金所期权行情失败',
    );
    return (raw ?? []).map((it: any) => ({
      code: String(it.code ?? ''),
      name: String(it.name ?? ''),
      price: numOrNull(it.price),
      change: numOrNull(it.change),
      changePct: numOrNull(it.changePercent),
      volume: numOrNull(it.volume),
      amount: numOrNull(it.amount),
      openInterest: numOrNull(it.openInterest),
      strikePrice: numOrNull(it.strikePrice),
      remainDays: numOrNull(it.remainDays),
      prevSettle: numOrNull(it.prevSettle),
      open: numOrNull(it.open),
    }));
  }

  /** 期权龙虎榜 */
  async getOptionLhb(params: { symbol: Symbol; date: string }): Promise<OptionLhbItem[]> {
    const raw: any[] = await this.guard(
      this.sdk.options.lhb(toSdkCode(params.symbol), params.date.replace(/-/g, '')),
      '期权龙虎榜失败',
    );
    return (raw ?? []).map((it: any) => ({
      tradeType: String(it.tradeType ?? ''),
      date: String(it.date ?? ''),
      symbol: String(it.symbol ?? ''),
      targetName: String(it.targetName ?? ''),
      rank: Number(it.rank) || 0,
      memberName: String(it.memberName ?? ''),
      buyVolume: numOrNull(it.buyVolume),
      sellVolume: numOrNull(it.sellVolume),
      netBuyVolume: numOrNull(it.netBuyVolume),
      buyVolumeRatio: numOrNull(it.buyVolumeRatio),
      sellVolumeRatio: numOrNull(it.sellVolumeRatio),
    }));
  }

  // ---------- 期货 ----------

  /**
   * 国内期货日/周/月 K。
   * ── 上游：sdk.futures.kline(code, { period, adjust, startDate, endDate })
   * ── 映射：openInterest→openInterest；changePercent→changePct；其余同名
   */
  async getFuturesKline(params: FuturesKlineParams): Promise<FuturesKlineBar[]> {
    const raw: any[] = await this.guard(
      this.sdk.futures.kline(params.code, {
        period: params.period ?? 'daily',
        startDate: params.startMs ? fmtDate(params.startMs).replace(/-/g, '') : undefined,
        endDate: params.endMs ? fmtDate(params.endMs).replace(/-/g, '') : undefined,
      }),
      '期货K线失败',
    );
    return mapFuturesKline(raw);
  }

  /** 全球期货实时报价 */
  async getFuturesGlobalSpot(opts?: { pageSize?: number }): Promise<GlobalFuturesQuote[]> {
    const raw: any[] = await this.guard(
      this.sdk.futures.globalSpot(opts?.pageSize ? { pageSize: opts.pageSize } : undefined),
      '全球期货行情失败',
    );
    return (raw ?? []).map((it: any) => ({
      code: String(it.code ?? ''),
      name: String(it.name ?? ''),
      price: numOrNull(it.price),
      change: numOrNull(it.change),
      changePct: numOrNull(it.changePercent),
      open: numOrNull(it.open),
      high: numOrNull(it.high),
      low: numOrNull(it.low),
      prevSettle: numOrNull(it.prevSettle),
      volume: numOrNull(it.volume),
      openInterest: numOrNull(it.openInterest),
    }));
  }

  /** 全球期货历史 K */
  async getFuturesGlobalKline(params: FuturesKlineParams): Promise<FuturesKlineBar[]> {
    const raw: any[] = await this.guard(
      this.sdk.futures.globalKline(params.code, {
        period: params.period ?? 'daily',
        startDate: params.startMs ? fmtDate(params.startMs).replace(/-/g, '') : undefined,
        endDate: params.endMs ? fmtDate(params.endMs).replace(/-/g, '') : undefined,
      }),
      '全球期货K线失败',
    );
    return mapFuturesKline(raw);
  }

  /** 期货库存品种列表 */
  async getFuturesInventorySymbols(): Promise<FuturesInventorySymbol[]> {
    const raw: any[] = await this.guard(this.sdk.futures.inventorySymbols(), '期货库存品种失败');
    return (raw ?? []).map((it: any) => ({
      code: String(it.code ?? ''),
      name: String(it.name ?? ''),
      marketCode: String(it.marketCode ?? ''),
    }));
  }

  /** 期货库存 */
  async getFuturesInventory(params: FuturesInventoryParams): Promise<FuturesInventoryPoint[]> {
    const raw: any[] = await this.guard(
      this.sdk.futures.inventory(params.code, {
        startDate: params.startMs ? fmtDate(params.startMs).replace(/-/g, '') : undefined,
      }),
      '期货库存失败',
    );
    return (raw ?? []).map((it: any) => ({
      code: String(it.code ?? params.code),
      date: String(it.date ?? ''),
      inventory: numOrNull(it.inventory),
      change: numOrNull(it.change),
    }));
  }

  /** COMEX 库存（金/银） */
  async getFuturesComexInventory(params: { metal: 'gold' | 'silver'; startMs?: number; endMs?: number }): Promise<ComexInventoryPoint[]> {
    const raw: any[] = await this.guard(
      this.sdk.futures.comexInventory(params.metal),
      'COMEX库存失败',
    );
    return (raw ?? []).map((it: any) => ({
      date: String(it.date ?? ''),
      name: String(it.name ?? ''),
      storageTon: numOrNull(it.storageTon),
      storageOunce: numOrNull(it.storageOunce),
    }));
  }

  // ---------- 北向资金 ----------

  /**
   * 北向/南向分时净流入。
   * ── 上游：sdk.northbound.minute(direction?)
   * ── 单位：万元（源字段 shanghaiNetInflow/shenzhenNetInflow/totalNetInflow）
   */
  async getNorthboundMinute(direction?: NorthboundDirection): Promise<NorthboundMinutePoint[]> {
    const raw: any = await this.guard(this.sdk.northbound.minute(direction), '北向分时失败');
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      date: String(it.date ?? ''),
      time: String(it.time ?? ''),
      shanghaiNetInflow: numOrNull(it.shanghaiNetInflow),
      shenzhenNetInflow: numOrNull(it.shenzhenNetInflow),
      totalNetInflow: numOrNull(it.totalNetInflow),
    }));
  }

  /** 沪深港通市场资金流向汇总 */
  async getNorthboundSummary(): Promise<NorthboundFlowSummaryItem[]> {
    const raw: any = await this.guard(this.sdk.northbound.summary(), '北向汇总失败');
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      date: String(it.date ?? ''),
      boardName: String(it.boardName ?? ''),
      direction: String(it.direction ?? ''),
      status: String(it.status ?? ''),
      netBuyAmount: numOrNull(it.netBuyAmount),
      netInflow: numOrNull(it.netInflow),
      remainAmount: numOrNull(it.remainAmount),
      upCount: numOrNull(it.upCount),
      downCount: numOrNull(it.downCount),
      flatCount: numOrNull(it.flatCount),
      indexCode: String(it.indexCode ?? ''),
      indexName: String(it.indexName ?? ''),
      indexChangePct: numOrNull(it.indexChangePercent),
    }));
  }

  /** 北向持股排行 */
  async getNorthboundHoldingRank(params?: NorthboundHoldingRankParams): Promise<NorthboundHoldingItem[]> {
    const raw: any = await this.guard(
      this.sdk.northbound.holdingRank({
        market: params?.market,
        period: params?.period,
        date: params?.date ? params.date.replace(/-/g, '') : undefined,
      }),
      '北向持股排行失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      date: String(it.date ?? ''),
      symbol: { code: String(it.code ?? ''), exchange: exchangeOf('CN', it.code ?? '') },
      name: String(it.name ?? ''),
      close: numOrNull(it.close),
      changePct: numOrNull(it.changePercent),
      holdShares: numOrNull(it.holdShares),
      holdMarketValue: numOrNull(it.holdMarketValue),
      holdRatioFloat: numOrNull(it.holdRatioFloat),
      holdRatioTotal: numOrNull(it.holdRatioTotal),
      addShares: numOrNull(it.addShares),
      addMarketValue: numOrNull(it.addMarketValue),
      sector: String(it.sector ?? ''),
    }));
  }

  /** 北向资金历史（按日） */
  async getNorthboundHistory(params?: NorthboundHistoryParams): Promise<NorthboundHistoryPoint[]> {
    const raw: any = await this.guard(
      this.sdk.northbound.history(params?.direction, {
        startDate: params?.startMs ? fmtDate(params.startMs) : undefined,
        endDate: params?.endMs ? fmtDate(params.endMs) : undefined,
      }),
      '北向历史失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      date: String(it.date ?? ''),
      netBuyAmount: numOrNull(it.netBuyAmount),
      buyAmount: numOrNull(it.buyAmount),
      sellAmount: numOrNull(it.sellAmount),
      accNetBuyAmount: numOrNull(it.accNetBuyAmount),
      netInflow: numOrNull(it.netInflow),
      remainAmount: numOrNull(it.remainAmount),
      topStockCode: it.topStockCode ?? null,
      topStockName: it.topStockName ?? null,
      topStockChangePct: numOrNull(it.topStockChangePercent),
    }));
  }

  /** 个股北向持仓历史 */
  async getNorthboundIndividual(params: NorthboundIndividualParams): Promise<NorthboundIndividualPoint[]> {
    const raw: any = await this.guard(
      this.sdk.northbound.individual(toSdkCode(params.symbol), {
        startDate: params.startMs ? fmtDate(params.startMs) : undefined,
        endDate: params.endMs ? fmtDate(params.endMs) : undefined,
      }),
      '北向个股持仓失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      date: String(it.date ?? ''),
      holdShares: numOrNull(it.holdShares),
      holdMarketValue: numOrNull(it.holdMarketValue),
      holdRatioFloat: numOrNull(it.holdRatioFloat),
      holdRatioTotal: numOrNull(it.holdRatioTotal),
      close: numOrNull(it.close),
      changePct: numOrNull(it.changePercent),
    }));
  }

  // ---------- 筹码分布 ----------

  /**
   * 筹码分布 —— A/HK/US 统一入口（按 symbol.exchange 分命名空间）。
   * ── 上游：sdk.chips.cn|hk|us(code, { range, includeHistogram, decimals })
   * ── 口径：range 默认 120（东财）；0 = akshare 全量；profitRatio 0..1
   */
  async getChipDistribution(params: ChipDistributionParams): Promise<ChipDistributionPoint[]> {
    const ns = params.symbol.exchange === 'HK' ? 'hk' : params.symbol.exchange === 'US' ? 'us' : 'cn';
    const raw: any[] = await this.guard(
      this.sdk.chips[ns](toSdkCode(params.symbol), {
        range: params.range,
        includeHistogram: params.includeHistogram,
        decimals: params.decimals,
      }),
      '筹码分布失败',
    );
    return (raw ?? []).map((it: any) => ({
      date: String(it.date ?? ''),
      profitRatio: numOrNull(it.profitRatio),
      avgCost: numOrNull(it.avgCost),
      cost90Low: numOrNull(it.cost90Low),
      cost90High: numOrNull(it.cost90High),
      concentration90: numOrNull(it.concentration90),
      cost70Low: numOrNull(it.cost70Low),
      cost70High: numOrNull(it.cost70High),
      concentration70: numOrNull(it.concentration70),
      histogram: Array.isArray(it.histogram)
        ? it.histogram.map((h: any) => ({ price: num(h.price), ratio: num(h.ratio) }))
        : undefined,
    }));
  }

  // ---------- 融资融券 ----------

  /** 全市场融资融券账户统计（按日） */
  async getMarginAccountInfo(): Promise<MarginAccountStat[]> {
    const raw: any = await this.guard(this.sdk.margin.accountInfo(), '两融账户统计失败');
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      date: String(it.date ?? ''),
      finBalance: numOrNull(it.finBalance),
      loanBalance: numOrNull(it.loanBalance),
      finBuyAmount: numOrNull(it.finBuyAmount),
      loanSellAmount: numOrNull(it.loanSellAmount),
      investorCount: numOrNull(it.investorCount),
      liabilityInvestorCount: numOrNull(it.liabilityInvestorCount),
      totalGuarantee: numOrNull(it.totalGuarantee),
      avgGuaranteeRatio: numOrNull(it.avgGuaranteeRatio),
    }));
  }

  /** 融资融券标的证券明细 */
  async getMarginTargetList(date?: string): Promise<MarginTargetStat[]> {
    const raw: any = await this.guard(
      this.sdk.margin.targetList(date),
      '两融标的列表失败',
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.item ?? [];
    return rows.map((it: any) => ({
      symbol: { code: String(it.code ?? ''), exchange: exchangeOf('CN', it.code ?? '') },
      name: String(it.name ?? ''),
      date: String(it.date ?? ''),
      finBalance: numOrNull(it.finBalance),
      finBuyAmount: numOrNull(it.finBuyAmount),
      finRepayAmount: numOrNull(it.finRepayAmount),
      loanBalance: numOrNull(it.loanBalance),
      loanSellVolume: numOrNull(it.loanSellVolume),
      loanRepayVolume: numOrNull(it.loanRepayVolume),
    }));
  }

  // ---------- 概念板块 ----------

  /**
   * 概念板块行情榜 —— 与 getStockIndustryBoard 对称。
   * ── 上游：sdk.board.concept.list()（含全字段，勿用 spot——spot 是 KV）
   * ── 注意：无成交额字段，totalMarketCap 作块大小代理；涨跌幅用 changePercent
   */
  async getConceptBoards(params?: ConceptBoardParams): Promise<ConceptBoardItem[]> {
    const list: any[] = await this.guard(this.sdk.board.concept.list(), '概念板块列表失败');
    const rows = list ?? [];
    const limit = params?.limit;
    const target = typeof limit === 'number' && limit > 0 ? rows.slice(0, limit) : rows;
    return target.map((b: any) => ({
      code: String(b?.code ?? ''),
      name: String(b?.name ?? ''),
      rank: b?.rank != null ? Number(b.rank) : undefined,
      price: numOrNull(b?.price),
      change: numOrNull(b?.change),
      changePct: numOrNull(b?.changePercent),
      totalMarketCap: numOrNull(b?.totalMarketCap),
      turnoverRate: numOrNull(b?.turnoverRate),
      riseCount: numOrNull(b?.riseCount),
      fallCount: numOrNull(b?.fallCount),
      leadingStock: b?.leadingStock ?? null,
      leadingStockChangePct: numOrNull(b?.leadingStockChangePercent),
    }));
  }

  /** 概念板块成分股 */
  async getConceptBoardConstituents(symbol: Symbol): Promise<ConceptBoardConstituentItem[]> {
    const raw: any[] = await this.guard(
      this.sdk.board.concept.constituents(toSdkCode(symbol)),
      '概念板块成分失败',
    );
    return (raw ?? []).map((it: any) => ({
      symbol: { code: String(it.code ?? ''), exchange: exchangeOf('CN', it.code ?? '') },
      name: String(it.name ?? ''),
      rank: it.rank != null ? Number(it.rank) : undefined,
      price: numOrNull(it.price),
      changePct: numOrNull(it.changePercent),
      volume: numOrNull(it.volume),
      amount: numOrNull(it.amount),
    }));
  }

  /** 概念板块 K 线 → 统一 Candle */
  async getConceptBoardKline(params: ConceptBoardKlineParams): Promise<Candle[]> {
    const raw: any[] = await this.guard(
      this.sdk.board.concept.kline(toSdkCode(params.symbol), {
        period: params.period ?? 'daily',
        adjust: params.adjust ?? '',
        startDate: params.startMs ? fmtDate(params.startMs) : undefined,
        endDate: params.endMs ? fmtDate(params.endMs) : undefined,
      }),
      '概念板块K线失败',
    );
    return (raw ?? []).map((it: any) => ({
      datetime: String(it.date ?? ''),
      open: numOrNull(it.open) ?? 0,
      high: numOrNull(it.high) ?? 0,
      low: numOrNull(it.low) ?? 0,
      close: numOrNull(it.close) ?? 0,
      volume: numOrNull(it.volume) ?? 0,
      amount: numOrNull(it.amount) ?? undefined,
    }));
  }

  // ============================================================
  // 二、SDK 专属能力扩展方法（明确「非同花顺官方口径」场景调用）
  // ============================================================

  /** 港股行情 */
  async getQuotesHK(symbols: Symbol[]): Promise<Quote[]> {
    return this.getQuotes(symbols.map((s) => ({ ...s, exchange: 'HK' as const })));
  }
  /** 美股行情 */
  async getQuotesUS(symbols: Symbol[]): Promise<Quote[]> {
    return this.getQuotes(symbols.map((s) => ({ ...s, exchange: 'US' as const })));
  }
  /** 场内基金行情 */
  async getFundQuotes(symbols: Symbol[]): Promise<Quote[]> {
    return this.getQuotes(symbols.map((s) => ({ ...s, exchange: 'OF' as const })));
  }
  /** 跨市场批量行情 */
  async getQuotesBatch(symbols: Symbol[]): Promise<Quote[]> {
    return this.getQuotes(symbols);
  }

  /** 港股历史 K 线 */
  async getKlineHK(params: KlineParams): Promise<Candle[]> {
    return this.getKline({ ...params, symbol: { ...params.symbol, exchange: 'HK' as const } });
  }
  /** 美股历史 K 线 */
  async getKlineUS(params: KlineParams): Promise<Candle[]> {
    return this.getKline({ ...params, symbol: { ...params.symbol, exchange: 'US' as const } });
  }

  /** A 股分钟级 K 线（1/5/15/30/60） */
  async getMinuteKlineCN(code: string, opts: { period: '1' | '5' | '15' | '30' | '60'; adjust?: '' | 'qfq' | 'hfq'; startMs?: number; endMs?: number }) {
    return this.guard(
      this.sdk.kline.cnMinute(code, {
        period: opts.period,
        adjust: opts.adjust ?? '',
        startDate: opts.startMs ? fmtDate(opts.startMs) : undefined,
        endDate: opts.endMs ? fmtDate(opts.endMs) : undefined,
      }),
      'A股分钟K线失败',
    );
  }
  async getMinuteKlineHK(code: string, opts: { period: '1' | '5' | '15' | '30' | '60'; adjust?: '' | 'qfq' | 'hfq'; startMs?: number; endMs?: number }) {
    return this.guard(
      this.sdk.kline.hkMinute(code, {
        period: opts.period,
        adjust: opts.adjust ?? '',
        startDate: opts.startMs ? fmtDate(opts.startMs) : undefined,
        endDate: opts.endMs ? fmtDate(opts.endMs) : undefined,
      }),
      '港股分钟K线失败',
    );
  }
  async getMinuteKlineUS(code: string, opts: { period: '1' | '5' | '15' | '30' | '60'; adjust?: '' | 'qfq' | 'hfq'; startMs?: number; endMs?: number }) {
    return this.guard(
      this.sdk.kline.usMinute(code, {
        period: opts.period,
        adjust: opts.adjust ?? '',
        startDate: opts.startMs ? fmtDate(opts.startMs) : undefined,
        endDate: opts.endMs ? fmtDate(opts.endMs) : undefined,
      }),
      '美股分钟K线失败',
    );
  }

  /** 当日分时（仅 A 股；港股 / 美股 SDK 未提供 -> 3004） */
  async getTodayTimelineCN(code: string) {
    return this.guard(this.sdk.quotes.timeline(code), 'A股当日分时失败');
  }
  async getTodayTimelineHK(): Promise<never> {
    return unsupported('getTodayTimelineHK');
  }
  async getTodayTimelineUS(): Promise<never> {
    return unsupported('getTodayTimelineUS');
  }

  /** 实时逐笔成交：SDK 未提供 -> 3004（由 stock-api 兜底源覆盖） */
  async getRealTimeTicks(): Promise<never> {
    return unsupported('getRealTimeTicks');
  }

  /** 港股五档盘口（HKQuote 本版本无盘口字段，返回空，如实说明） */
  async getOrderBookHK(symbol: Symbol): Promise<OrderBook> {
    return { symbol, bids: [], asks: [], updatedAt: Date.now() };
  }
  /** 美股五档盘口 */
  async getOrderBookUS(symbol: Symbol): Promise<OrderBook> {
    return { symbol, bids: [], asks: [], updatedAt: Date.now() };
  }

  /** A 股市场概览（大盘资金流近似） */
  async getMarketOverviewCN(): Promise<any> {
    return this.guard(this.sdk.fundFlow.market(), '市场概览失败');
  }

  /** 板块实时行情 */
  async getBoardQuotes(symbols: Symbol[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];
    // 板块行情取 list 而非 spot：board.industry.spot 返回的是 KV 结构
    // （{ item: string; value: number | null }[]，字段名为上游内部代号），
    // 而 list 直接给出 name/code/price/changePercent/... 全字段，无需二次解析。
    const raw: any[] = await this.guard(this.sdk.board.industry.list(), '板块行情失败');
    const byCode = new Map<string, any>((raw ?? []).map((r) => [String(r?.code ?? ''), r]));
    return symbols.map((s) => {
      const r: any = byCode.get(toSdkCode(s)) ?? {};
      return {
        symbol: s,
        last: num(r.price),
        // 本源不返回板块昨收 / 开高低 / 成交量额，统一置 0（消费方以 changePct 为准）
        prevClose: 0,
        open: 0,
        high: 0,
        low: 0,
        volume: 0,
        amount: num(r.totalMarketCap),
        changePct: numOrNull(r.changePercent) ?? undefined,
        change: numOrNull(r.change) ?? undefined,
        updatedAt: Date.now(),
      };
    });
  }
  /** 板块成分股 */
  async getBoardConstituents(symbol: Symbol): Promise<IndexConstituent[]> {
    return this.getIndexConstituents(symbol);
  }

  /** 解析标的（关键词 -> 首个命中） */
  async resolveSymbol(keyword: string): Promise<Instrument | null> {
    const res = await this.search({ keyword });
    return res[0] ?? null;
  }

  /** 给 K 线追加技术指标（MA/MACD/RSI/BOLL…），返回带指标的 candles */
  async addIndicators(symbol: Symbol, config: { period?: 'daily' | 'weekly' | 'monthly'; adjust?: '' | 'qfq' | 'hfq'; indicators?: Record<string, unknown> }) {
    return this.guard(
      this.sdk.kline.withIndicators(toSdkCode(symbol), {
        period: config.period ?? 'daily',
        adjust: config.adjust ?? '',
        indicators: config.indicators ?? {},
      }),
      '指标计算失败',
    );
  }

  /** 计算筹码分布（A 股 / 港股 / 美股） */
  async calcChipDistribution(
    symbol: Symbol,
    opts?: { range?: number; includeHistogram?: boolean; decimals?: number },
  ) {
    const ns = symbol.exchange === 'HK' ? 'hk' : symbol.exchange === 'US' ? 'us' : 'cn';
    // stock-sdk 的 ChipDistributionRequestOptions 仅支持 range / includeHistogram / decimals
    return this.guard(
      this.sdk.chips[ns](toSdkCode(symbol), {
        range: opts?.range,
        includeHistogram: opts?.includeHistogram,
        decimals: opts?.decimals,
      }),
      '筹码分布失败',
    );
  }

  /** 信号计算（MA/MACD/KDJ/RSI/BOLL/SAR 金叉死叉） */
  async calcSignals(symbol: Symbol, config?: { period?: 'daily' | 'weekly' | 'monthly'; adjust?: '' | 'qfq' | 'hfq'; maFast?: number; maSlow?: number }) {
    return this.guard(
      this.sdk.kline.signals(toSdkCode(symbol), {
        period: config?.period ?? 'daily',
        adjust: config?.adjust ?? '',
        maFast: config?.maFast,
        maSlow: config?.maSlow,
      }),
      '信号计算失败',
    );
  }

  /** 选股 / 回测：stock-sdk 未提供 -> 3004（由同花顺主源覆盖） */
  async screen(): Promise<never> {
    return unsupported('screen');
  }
  async backtest(): Promise<never> {
    return unsupported('backtest');
  }

  // -------- 资金流向 / 北向 / 龙虎榜 / 大宗 / 两融 等扩展封装 --------
  /** 个股资金流历史（源专属；统一契约走 getMainForce） */
  async getStockFundFlow(symbol: Symbol, opts?: { period?: 'daily' | 'weekly' | 'monthly' }) {
    return this.guard(this.sdk.fundFlow.individual(toSdkCode(symbol), { period: opts?.period ?? 'daily' }), '个股资金流失败');
  }
  /** 资金流排行（源专属；统一契约走 getStockFundsFlowing） */
  async getFundFlowRank(opts?: { indicator?: 'today' | '3day' | '5day' | '10day' }) {
    return this.guard(this.sdk.fundFlow.rank({ indicator: opts?.indicator ?? 'today' }), '资金流排行失败');
  }
  /** 板块资金流排行（源专属；统一契约走 getStockIndustryFundsFlowing） */
  async getSectorFundFlowRank(opts?: { indicator?: 'today' | '3day' | '5day' | '10day'; sectorType?: 'industry' | 'concept' | 'region' }) {
    return this.guard(this.sdk.fundFlow.sectorRank({ indicator: opts?.indicator ?? 'today', sectorType: opts?.sectorType }), '板块资金流排行失败');
  }
  /** 板块异动 */
  async getBoardChanges() {
    return this.guard(this.sdk.marketEvent.boardChanges(), '板块异动失败');
  }
  /** 个股异动历史 */
  async getIndividualChangesHistory(symbol: Symbol, opts?: { days?: number }) {
    return this.guard(this.sdk.marketEvent.individualChangesHistory(toSdkCode(symbol), { days: opts?.days }), '个股异动历史失败');
  }
  // 注：getDragonTigerStockStats / getMarketFundFlow / getFundDividendList / getFundRankHistory 统一契约见上文
  /** 大宗交易明细 */
  async getBlockTradeDetail(opts?: { startDate?: string; endDate?: string }) {
    return this.guard(this.sdk.blockTrade.detail(opts ?? {}), '大宗交易明细失败');
  }
  /** 基金主题列表 */
  async getFundThemeList(opts?: Record<string, unknown>) {
    return this.guard(this.sdk.fund.theme.getThemeList(opts ?? {}), '基金主题列表失败');
  }
  /** 概念板块列表 */
  async getConceptBoardList() {
    return this.guard(this.sdk.board.concept.list(), '概念板块列表失败');
  }
  /** 行业板块行情快照 */
  async getIndustryBoardSpot(code: string) {
    return this.guard(this.sdk.board.industry.spot(code), '行业板块行情失败');
  }

  /**
   * 行业板块行情（统一方法 `getStockIndustryBoard`）。
   *
   * ── 传输协议 ─────────────────────────────────────────────
   * 上游：stock-sdk `board.industry.list()`（板块全量榜单，已含行情字段）
   * 编码：SDK 内部处理（上游为东方财富/腾讯系，GBK 由 SDK 解码）
   * 批量：一次性返回全部行业板块（约 80+ 个），无需分页
   * 代码体系：BK + 数字（如 BK1027），与同花顺 .TI 板块码不是一套
   *
   * ⚠️ 不要用 `board.industry.spot()` 取板块行情：它返回 KV 结构
   *    `{ item: string; value: number | null }[]`（item 是上游内部字段代号），
   *    不是 { code, changePercent } 对象数组；list() 已含全字段且语义明确。
   *
   * ── 请求 ─────────────────────────────────────────────────
   * | 字段  | 类型   | 必填 | 取值/格式        | 说明                     |
   * | limit | number | 否   | >0 的整数        | 只取前 N 个板块；缺省全量 |
   *
   * ── 响应（源字段，来自 IndustryBoard）────────────────────
   * | 字段                       | 类型          | 单位/取值     | 缺失语义             |
   * | code                       | string        | BK1027        | —                    |
   * | name                       | string        | 如"半导体"    | —                    |
   * | price                      | number\|null  | 点            | null = 无报价        |
   * | change / changePercent     | number\|null  | 百分点        | null = 停牌/无数据   |
   * | totalMarketCap             | number\|null  | 元            | null = 未统计        |
   * | turnoverRate               | number\|null  | %             | null = 未统计        |
   * | riseCount / fallCount      | number\|null  | 家            | null = 未统计        |
   * | leadingStock               | string\|null  | 股票名        | null = 无领涨股      |
   * | leadingStockChangePercent  | number\|null  | 百分点        | null = 同上          |
   * | rank                       | number        | 1..N          | 榜单序号             |
   *
   * ── 映射到统一类型 IndustryBoardItem ─────────────────────
   * code → code；name → name；changePercent → changePct；price → price；
   * totalMarketCap → amount（本源不返回板块成交额，用总市值作为"块大小"权重代理）；
   * turnoverRate / riseCount / fallCount / leadingStock 原样透传（IndustryBoardItem 为开放类型）。
   * 注：涨跌幅一律用 changePct，不要用 (last-prevClose)/prevClose —— 本源不给板块昨收。
   *
   * ── 失败与降级 ───────────────────────────────────────────
   * 网络/上游错误 → 包装为可重试 DataSourceError，由 SourceRouter 降级到其它源；
   * 只声明了本方法的源没有板块能力时抛 3004。
   */
  async getStockIndustryBoard(params?: IndustryBoardParams): Promise<IndustryBoardItem[]> {
    const list: any[] = await this.guard(this.sdk.board.industry.list(), '行业板块列表失败');
    const rows = list ?? [];
    const limit = params?.limit;
    const target = typeof limit === 'number' && limit > 0 ? rows.slice(0, limit) : rows;
    return target.map((b: any) => ({
      code: String(b?.code ?? ''),
      name: String(b?.name ?? ''),
      changePct: b?.changePercent != null ? Number(b.changePercent) : undefined,
      price: b?.price != null ? Number(b.price) : undefined,
      // 无成交额字段：用总市值作权重代理（与 getBoardQuotes 口径一致）
      amount: b?.totalMarketCap != null ? Number(b.totalMarketCap) : undefined,
      turnoverRate: b?.turnoverRate != null ? Number(b.turnoverRate) : undefined,
      riseCount: b?.riseCount != null ? Number(b.riseCount) : undefined,
      fallCount: b?.fallCount != null ? Number(b.fallCount) : undefined,
      leadingStock: b?.leadingStock ?? undefined,
      rank: b?.rank != null ? Number(b.rank) : undefined,
    }));
  }
  /** 行业板块分钟 K 线（源专属，未进统一契约） */
  async getIndustryMinuteKline(code: string, opts: { period: '1' | '5' | '15' | '30' | '60'; adjust?: '' | 'qfq' | 'hfq'; startDate?: string; endDate?: string }) {
    return this.guard(this.sdk.board.industry.minuteKline(code, opts), '行业板块分钟K线失败');
  }
  /** 概念板块行情快照 */
  async getConceptBoardSpot(code: string) {
    return this.guard(this.sdk.board.concept.spot(code), '概念板块行情失败');
  }
  /** 概念板块 K 线 */
  async getConceptKline(code: string, opts: { period?: 'daily' | 'weekly' | 'monthly'; adjust?: '' | 'qfq' | 'hfq'; startDate?: string; endDate?: string; limit?: number }) {
    return this.guard(this.sdk.board.concept.kline(code, opts), '概念板块K线失败');
  }
  /** 概念板块分钟 K 线 */
  async getConceptMinuteKline(code: string, opts: { period: '1' | '5' | '15' | '30' | '60'; adjust?: '' | 'qfq' | 'hfq'; startDate?: string; endDate?: string }) {
    return this.guard(this.sdk.board.concept.minuteKline(code, opts), '概念板块分钟K线失败');
  }

  // -------- 行情补充：简要行情 --------
  /** A 股简要行情（轻量字段） */
  async getQuotesSimpleCN(codes: string[]) {
    return this.guard(this.sdk.quotes.cnSimple(codes), 'A股简要行情失败');
  }
  // 注：getLargeOrderRatios / getIndividualChangeEvents 统一契约见上文

  // ============================================================
  // 三、期权 / 期货 命名空间（v2 完整能力补齐）
  // ============================================================

  // -------- 期权：股指 / 商品（ETF 细节已进统一契约） --------
  /** 股指期权实时。product: 'ho' | 'io' | 'mo'；contract: 如 'IO2408-P-3500' */
  async getOptionIndexSpot(product: 'ho' | 'io' | 'mo', contract: string) {
    return this.guard(this.sdk.options.index.spot(product, contract), '股指期权实时失败');
  }
  /** 股指期权 K 线。symbol 如 'IO2408-P-3500' */
  async getOptionIndexKline(symbol: string) {
    return this.guard(this.sdk.options.index.kline(symbol), '股指期权K线失败');
  }
  /** ETF 期权日 K 线。code 如 '10004336' */
  async getOptionEtfDailyKline(code: string) {
    return this.guard(this.sdk.options.etf.dailyKline(code), 'ETF期权日K失败');
  }
  /** ETF 期权五日分钟 K 线。code 如 '10004336' */
  async getOptionEtfFiveDayMinute(code: string) {
    return this.guard(this.sdk.options.etf.fiveDayMinute(code), 'ETF期权五日分钟K线失败');
  }
  /** 商品期权实时。variety: 品种代码（如 'CU'），contract: 合约（如 'CU2408'） */
  async getOptionCommoditySpot(variety: string, contract: string) {
    return this.guard(this.sdk.options.commodity.spot(variety, contract), '商品期权实时失败');
  }
  /** 商品期权 K 线。symbol 如 'CU2408' */
  async getOptionCommodityKline(symbol: string) {
    return this.guard(this.sdk.options.commodity.kline(symbol), '商品期权K线失败');
  }
  // 注：getOptionCffexQuotes / getOptionLhb / getFutures* 统一契约方法见上文 P0-B 段
  // 注：isTradingDay / nextTradingDay / prevTradingDay / getMarketStatus 统一契约见上文

  /** 全量代码表：按市场 */
  async getCodeList(market: 'cn' | 'hk' | 'us' | 'fund') {
    return this.guard(this.sdk.codes[market](), `代码表(${market})失败`);
  }
  /** 全量行情快照：按市场 */
  async getAllQuotes(market: 'cn' | 'hk' | 'us') {
    return this.guard<any[]>(this.sdk.batch[market](), `全量行情(${market})失败`);
  }
  /** 清空实例缓存 */
  clearCaches(): void {
    this.sdk.clearCaches();
  }
}

// ============ 工具函数 ============
function fmtDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function mapQuote(symbol: Symbol, r: any): Quote {
  // HK/US 上游字段名可能为 price 或 last；绝不把 prevClose 当成 last
  const lastRaw = r.price ?? r.last;
  // 上游带名称时写入 symbol（自选/详情展示用）
  const upstreamName = String(r.name ?? r.stockName ?? r.stock_name ?? '').trim();
  const nextSymbol: Symbol = upstreamName
    ? { ...symbol, name: upstreamName }
    : symbol;
  return {
    symbol: nextSymbol,
    last: num(lastRaw),
    prevClose: num(r.prevClose),
    open: num(r.open),
    high: num(r.high),
    low: num(r.low),
    volume: num(r.volume),
    amount: num(r.amount),
    change: r.change != null ? num(r.change) : undefined,
    changePct: r.changePercent != null ? num(r.changePercent) : undefined,
    amplitudePct: r.amplitude != null ? num(r.amplitude) : undefined,
    updatedAt: numOrNull(r.timestamp) ?? Date.now(),
  };
}

function mapFundQuote(symbol: Symbol, r: any): Quote {
  const upstreamName = String(r.name ?? r.fundName ?? '').trim();
  const nextSymbol: Symbol = upstreamName
    ? { ...symbol, name: upstreamName }
    : symbol;
  return {
    symbol: nextSymbol,
    last: num(r.nav),
    prevClose: num(r.accNav),
    open: 0,
    high: num(r.nav),
    low: num(r.nav),
    volume: 0,
    amount: 0,
    change: r.change != null ? num(r.change) : undefined,
    changePct: undefined,
    updatedAt: numOrNull(r.timestamp) ?? Date.now(),
  };
}

function mapMinuteKline(raw: any[]): Candle[] {
  return raw.map((it: any) => ({
    datetime: it.time ?? it.date,
    open: num(it.open),
    high: num(it.high),
    low: num(it.low),
    close: num(it.close),
    volume: num(it.volume),
    amount: it.amount != null ? num(it.amount) : undefined,
  }));
}

function mapInstrument(r: any): Instrument {
  const rawCode = String(r.code ?? '').trim();
  // stock-sdk 搜索结果可能带 sh/sz/hk 前缀（sz300750 / hk03986），
  // 必须拆前缀定交易所，否则会落到 exchangeOf 的默认 SH。
  let code = rawCode;
  let exchange: Symbol['exchange'] | null = null;
  const pref = rawCode.match(/^(sh|sz|bj|hk|us)(?=\d|[a-z])/i);
  if (pref) {
    const p = pref[1]!.toLowerCase();
    code = rawCode.slice(pref[0].length);
    exchange =
      p === 'sh' ? 'SH' : p === 'sz' ? 'SZ' : p === 'bj' ? 'BJ' : p === 'hk' ? 'HK' : 'US';
  }
  // 市场字段优先于纯数字推断（港股 00700 / 03986 等）
  const marketHint = String(r.market ?? '').toUpperCase();
  if (!exchange) {
    if (marketHint === 'HK') exchange = 'HK';
    else if (marketHint === 'US') exchange = 'US';
    else exchange = exchangeOf('CN', code);
  }
  const name = String(r.name ?? '');
  return {
    symbol: { code, exchange, name },
    name,
    market: exchange === 'HK' ? 'HK' : exchange === 'US' ? 'US' : 'A',
    assetType: (r.type as Instrument['assetType']) ?? 'a-share',
    currency: r.currency,
  };
}

function mapHot(symbol: Symbol, it: any): HotStock {
  return {
    symbol,
    name: String(it.name ?? ''),
    rank: numOrNull(it.rank) ?? 0,
    heat: numOrNull(it.heat ?? it.mainNetInflow) ?? 0,
    rankChange: numOrNull(it.rankChange) ?? 0,
    rankTrend: String(it.rankTrend ?? ''),
  };
}

function emptyValuation(s: Symbol): Valuation {
  return { symbol: s, name: null, peTtm: null, peMrq: null, pbMrq: null, psTtm: null, pcfTtm: null, timestamp: null };
}

// 自注册到数据源注册表（内置源）
register(SOURCE_ID, 'StockSDK', () => StockSdkSource.getInstance(), true);
