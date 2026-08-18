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
import { StockSDK, type RequestClientOptions, type StockChangeType } from 'stock-sdk';
import { DataSourceError, type MarketDataSource } from '../MarketDataSource';
import type {
  AdjustmentFactor,
  AnomalyStock,
  Candle,
  DragonTigerList,
  DragonTigerStock,
  FundHolder,
  FundHolding,
  FundNav,
  FundProfile,
  FundReturn,
  FundType,
  HistoricalFinancialParams,
  HotStock,
  IndicatorsParams,
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
} from '../types';
import { register } from '../DataSourceRegistry';
import { cleanCandles } from '../candleValidity';

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
  // A 股按代码首位推断
  if (code.startsWith('6')) return 'SH';
  if (code.startsWith('0') || code.startsWith('3')) return 'SZ';
  if (code.startsWith('8') || code.startsWith('4') || code.startsWith('92')) return 'BJ';
  return 'SH';
}

export class StockSdkSource implements MarketDataSource {
  readonly id = SOURCE_ID;
  readonly label = 'StockSDK';

  private static _instance: StockSdkSource | null = null;
  static getInstance(): StockSdkSource {
    if (!this._instance) this._instance = new StockSdkSource();
    return this._instance;
  }

  private _sdk: StockSDK | null = null;
  private _options?: RequestClientOptions;

  /** 复用单一 SDK 实例（避免每次调用都 new），类型直接来自 stock-sdk 包 */
  private get sdk(): StockSDK {
    if (!this._sdk) this._sdk = new StockSDK(this._options);
    return this._sdk;
  }

  /**
   * 注入 stock-sdk 运行配置（超时 / 重试 / baseUrl 等），可选。
   * 上层可在注册本源时通过 init(options) 传入，未传则使用 SDK 默认配置。
   */
  async init(options?: RequestClientOptions): Promise<void> {
    this._options = options;
    this._sdk = new StockSDK(options);
  }
  async dispose(): Promise<void> {}

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
    exchange?: string;
    assetType?: string;
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

    const out: Quote[] = [];
    const nsMap: Array<['cn' | 'hk' | 'us' | 'fund', Symbol[]]> = [
      ['cn', groups.cn],
      ['hk', groups.hk],
      ['us', groups.us],
      ['fund', groups.fund],
    ];
    for (const [ns, syms] of nsMap) {
      if (syms.length === 0) continue;
      const codes = syms.map(toSdkCode);
      const raw: any[] = await this.guard<any[]>(this.sdk.quotes[ns](codes), `${ns.toUpperCase()} 行情失败`);
      const byCode = new Map<string, any>((raw ?? []).map((r) => [r.code ?? '', r]));
      syms.forEach((s, i) => {
        const r: any = byCode.get(codes[i]) ?? {};
        out.push(ns === 'fund' ? mapFundQuote(s, r) : mapQuote(s, r));
      });
    }
    return out;
  }

  /**
   * 五档盘口：仅 A 股 FullQuote 含 bid/ask 五档；港股 / 美股 Quote 类型在本 SDK 版本未返回盘口，
   * 如实返回空盘口（绝不伪造数据）。ETF 场内基金 FundQuote 也无盘口。
   */
  async getOrderBook(symbol: Symbol): Promise<OrderBook> {
    if (symbol.exchange === 'HK' || symbol.exchange === 'US' || symbol.exchange === 'OF') {
      return { symbol, bids: [], asks: [], updatedAt: Date.now() };
    }
    const raw: any[] = await this.guard(this.sdk.quotes.cn([toSdkCode(symbol)]), '盘口失败');
    const r: any = (raw ?? [])[0] ?? {};
    const bids = (r.bid ?? []).map((b: any) => ({ price: num(b.price), volume: num(b.volume) }));
    const asks = (r.ask ?? []).map((a: any) => ({ price: num(a.price), volume: num(a.volume) }));
    return { symbol, bids, asks, updatedAt: numOrNull(r.timestamp) ?? Date.now() };
  }

  /**
   * 历史 K 线：日 / 周 / 月走 kline.cn/hk/us（daily/weekly/monthly）；
   * 分钟级（1m~60m）走 kline.cnMinute/hkMinute/usMinute。
   */
  async getKline(params: KlineParams): Promise<Candle[]> {
    const code = toSdkCode(params.symbol);
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
        '分钟K线失败',
      );
      return cleanCandles(mapMinuteKline(raw ?? []));
    }

    const periodMap: Record<string, 'daily' | 'weekly' | 'monthly'> = {
      day: 'daily',
      week: 'weekly',
      month: 'monthly',
    };
    const ns = params.symbol.exchange === 'HK' ? 'hk' : params.symbol.exchange === 'US' ? 'us' : 'cn';
    const raw: any[] = await this.guard(
      this.sdk.kline[ns](code, { ...opts, period: periodMap[params.period] }),
      'K线失败',
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
  }

  /** 复权事件：委托 SDK reference.dividendDetail（分红 / 送转明细） */
  async getAdjustmentFactors(symbol: Symbol, from?: string, to?: string): Promise<AdjustmentFactor[]> {
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
    return (raw ?? []).map((r: any) => ({
      symbol: { code: String(r.code ?? ''), exchange: 'SH', name: r.name },
      name: String(r.name ?? ''),
    }));
  }

  async getIndexConstituents(symbol: Symbol): Promise<IndexConstituent[]> {
    const raw: any[] = await this.guard(
      this.sdk.board.industry.constituents(toSdkCode(symbol)),
      '板块成分失败',
    );
    return (raw ?? []).map((r: any) => ({
      symbol: { code: String(r.code ?? ''), exchange: exchangeOf('CN', r.code ?? ''), name: r.name },
      name: String(r.name ?? ''),
    }));
  }

  /** 指数 / 板块行情：批量行情接口可返回指数（含 sh000001 等） */
  async getIndexQuotes(symbols: Symbol[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];
    const raw: any[] = await this.guard(
      this.sdk.batch.byCodes(symbols.map(toSdkCode)),
      '指数行情失败',
    );
    const byCode = new Map<string, any>((raw ?? []).map((r) => [r.code ?? '', r]));
    return symbols.map((s) => mapQuote(s, byCode.get(toSdkCode(s)) ?? {}));
  }

  async getIndexKline(params: KlineParams): Promise<Candle[]> {
    // 指数 K 线复用 A 股日 K（行业板块同样走 cn kline）
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
    _range?: string,
    navType?: string,
  ): Promise<FundNav[]> {
    // stock-sdk 的 fund.navHistory 仅接受 code（一次性返回全历史）；
    // navType 决定取「单位净值」还是「累计净值」，由本地映射选择字段。
    const r: any = await this.guard(this.sdk.fund.navHistory(toSdkCode(symbol)), '基金净值失败');
    const useAcc = navType === 'acc' || navType === 'accumulated';
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
  async getFundHolders(symbol: Symbol, _fundType: FundType, mergeScope?: string): Promise<FundHolder[]> {
    const r: any = await this.guard(this.sdk.fund.profile(toSdkCode(symbol)), '基金份额持有人失败');
    return (r.holderStructure ?? []).map((it: any) => ({
      symbol,
      mergeScope: (mergeScope as FundHolder['mergeScope']) ?? 'merged',
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
    return { items: list };
  }
  /** 连板天梯：涨停池按连板天数聚合排序 */
  async getLimitUpLadder(): Promise<unknown> {
    const res = await this.getLimitUpPool();
    return res.items.slice().sort((a, b) => b.continueDayCnt - a.continueDayCnt);
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
    const raw: any[] = await this.guard(
      this.sdk.board.industry.spot(symbols.map(toSdkCode).join(',')),
      '板块行情失败',
    );
    const byCode = new Map<string, any>((raw ?? []).map((r) => [r.code ?? '', r]));
    return symbols.map((s) => {
      const r: any = byCode.get(toSdkCode(s)) ?? {};
      return {
        symbol: s,
        last: num(r.price),
        prevClose: 0,
        open: 0,
        high: num(r.high),
        low: num(r.low),
        volume: num(r.volume),
        amount: num(r.amount),
        changePct: numOrNull(r.changePercent) ?? undefined,
        change: numOrNull(r.change) ?? undefined,
        updatedAt: numOrNull(r.timestamp) ?? Date.now(),
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
  /** 个股资金流历史 */
  async getStockFundFlow(symbol: Symbol, opts?: { period?: 'daily' | 'weekly' | 'monthly' }) {
    return this.guard(this.sdk.fundFlow.individual(toSdkCode(symbol), { period: opts?.period ?? 'daily' }), '个股资金流失败');
  }
  /** 大盘资金流（按日） */
  async getMarketFundFlow() {
    return this.guard(this.sdk.fundFlow.market(), '大盘资金流失败');
  }
  /** 资金流排行 */
  async getFundFlowRank(opts?: { indicator?: 'today' | '3day' | '5day' | '10day' }) {
    return this.guard(this.sdk.fundFlow.rank({ indicator: opts?.indicator ?? 'today' }), '资金流排行失败');
  }
  /** 板块资金流排行 */
  async getSectorFundFlowRank(opts?: { indicator?: 'today' | '3day' | '5day' | '10day'; sectorType?: 'industry' | 'concept' | 'region' }) {
    return this.guard(this.sdk.fundFlow.sectorRank({ indicator: opts?.indicator ?? 'today', sectorType: opts?.sectorType }), '板块资金流排行失败');
  }
  /** 北向分时 */
  async getNorthboundMinute(direction?: 'north' | 'south') {
    return this.guard(this.sdk.northbound.minute(direction), '北向分时失败');
  }
  /** 北向汇总 */
  async getNorthboundSummary() {
    return this.guard(this.sdk.northbound.summary(), '北向汇总失败');
  }
  /** 北向持股排行 */
  async getNorthboundHoldingRank(opts?: { market?: 'all' | 'shanghai' | 'shenzhen'; period?: 'today' | '3day' | '5day' | '10day' | 'month' | 'quarter' | 'year'; date?: string }) {
    return this.guard(this.sdk.northbound.holdingRank(opts ?? {}), '北向持股排行失败');
  }
  /** 北向历史 */
  async getNorthboundHistory(direction?: 'north' | 'south', opts?: { startDate?: string; endDate?: string }) {
    return this.guard(this.sdk.northbound.history(direction, opts ?? {}), '北向历史失败');
  }
  /** 盘口异动（按类型） */
  async getStockChanges(type?: StockChangeType | StockChangeType[] | 'all') {
    return this.guard(this.sdk.marketEvent.stockChanges(type ?? 'all'), '盘口异动失败');
  }
  /** 板块异动 */
  async getBoardChanges() {
    return this.guard(this.sdk.marketEvent.boardChanges(), '板块异动失败');
  }
  /** 个股异动历史 */
  async getIndividualChangesHistory(symbol: Symbol, opts?: { days?: number }) {
    return this.guard(this.sdk.marketEvent.individualChangesHistory(toSdkCode(symbol), { days: opts?.days }), '个股异动历史失败');
  }
  /** 龙虎榜个股上榜统计 */
  async getDragonTigerStockStats(period?: '1month' | '3month' | '6month' | '1year') {
    return this.guard(this.sdk.dragonTiger.stockStats(period), '龙虎榜个股统计失败');
  }
  /** 龙虎榜机构买卖 */
  async getDragonTigerInstitution(opts: { startDate: string; endDate: string }) {
    return this.guard(this.sdk.dragonTiger.institution(opts), '龙虎榜机构买卖失败');
  }
  /** 龙虎榜营业部排行 */
  async getDragonTigerBranchRank(period?: '1month' | '3month' | '6month' | '1year') {
    return this.guard(this.sdk.dragonTiger.branchRank(period), '龙虎榜营业部排行失败');
  }
  /** 龙虎榜个股席位明细 */
  async getDragonTigerSeatDetail(symbol: Symbol, date: string) {
    return this.guard(this.sdk.dragonTiger.seatDetail(toSdkCode(symbol), date), '龙虎榜席位明细失败');
  }
  /** 大宗交易明细 */
  async getBlockTradeDetail(opts?: { startDate?: string; endDate?: string }) {
    return this.guard(this.sdk.blockTrade.detail(opts ?? {}), '大宗交易明细失败');
  }
  /** 大宗交易市场统计 */
  async getBlockTradeMarketStat() {
    return this.guard(this.sdk.blockTrade.marketStat(), '大宗交易市场统计失败');
  }
  /** 融资融券账户统计 */
  async getMarginAccountInfo() {
    return this.guard(this.sdk.margin.accountInfo(), '融资融券账户统计失败');
  }
  /** 融资融券标的列表 */
  async getMarginTargetList(date?: string) {
    return this.guard(this.sdk.margin.targetList(date), '融资融券标的列表失败');
  }
  /** 基金分红列表 */
  async getFundDividendList(opts?: { year?: number | string; page?: number | 'all'; fundType?: string }) {
    return this.guard(this.sdk.fund.dividendList(opts ?? {}), '基金分红列表失败');
  }
  /** 基金同类排名走势 */
  async getFundRankHistory(symbol: Symbol) {
    return this.guard(this.sdk.fund.rankHistory(toSdkCode(symbol)), '基金排名走势失败');
  }
  /** 基金主题列表 */
  async getFundThemeList(opts?: Record<string, unknown>) {
    return this.guard(this.sdk.fund.theme.getThemeList(opts ?? {}), '基金主题列表失败');
  }
  /** 概念板块列表 */
  async getConceptBoardList() {
    return this.guard(this.sdk.board.concept.list(), '概念板块列表失败');
  }
  /** 概念板块成分 */
  async getConceptBoardConstituents(code: string) {
    return this.guard(this.sdk.board.concept.constituents(code), '概念板块成分失败');
  }
  /** 行业板块行情快照 */
  async getIndustryBoardSpot(code: string) {
    return this.guard(this.sdk.board.industry.spot(code), '行业板块行情失败');
  }
  /** 行业板块 K 线（日/周/月） */
  async getIndustryKline(code: string, opts: { period?: 'daily' | 'weekly' | 'monthly'; adjust?: '' | 'qfq' | 'hfq'; startDate?: string; endDate?: string; limit?: number }) {
    return this.guard(this.sdk.board.industry.kline(code, opts), '行业板块K线失败');
  }
  /** 行业板块分钟 K 线 */
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

  // -------- 行情补充：简要 / 盘口大单 --------
  /** A 股简要行情（轻量字段） */
  async getQuotesSimpleCN(codes: string[]) {
    return this.guard(this.sdk.quotes.cnSimple(codes), 'A股简要行情失败');
  }
  /** 盘口大单（委托明细） */
  async getLargeOrders(codes: string[]) {
    return this.guard(this.sdk.quotes.largeOrder(codes), '盘口大单失败');
  }

  // -------- 资金流向补充：板块资金流历史 --------
  /** 板块资金流历史。symbol 形如 'BK0438'（板块代码） */
  async getSectorFundFlowHistory(symbol: string, opts?: { period?: 'daily' | 'weekly' | 'monthly' }) {
    return this.guard(this.sdk.fundFlow.sectorHistory(symbol, opts ?? {}), '板块资金流历史失败');
  }

  // -------- 北向补充：个股持股 --------
  /** 北向个股持股（实时）。symbol 形如 '000001' */
  async getNorthboundIndividual(symbol: string, opts?: { startDate?: string; endDate?: string }) {
    return this.guard(this.sdk.northbound.individual(symbol, opts), '北向个股持股失败');
  }

  // -------- 市场异动补充：个股异动 --------
  /** 个股异动（涨停池 / 跌停池 / 打开涨停 等）。type 见 Stock SDK StockChangeType */
  async getIndividualChanges(symbol: string, date?: string) {
    return this.guard(this.sdk.marketEvent.individualChanges(symbol, { date }), '个股异动失败');
  }

  // ============================================================
  // 三、期权 / 期货 命名空间（v2 完整能力补齐）
  // ============================================================

  // -------- 期权：股指 / ETF / 商品 / 中金所 / 龙虎榜 --------
  /** 股指期权实时。product: 'ho' | 'io' | 'mo'；contract: 如 'IO2408-P-3500' */
  async getOptionIndexSpot(product: 'ho' | 'io' | 'mo', contract: string) {
    return this.guard(this.sdk.options.index.spot(product, contract), '股指期权实时失败');
  }
  /** 股指期权 K 线。symbol 如 'IO2408-P-3500' */
  async getOptionIndexKline(symbol: string) {
    return this.guard(this.sdk.options.index.kline(symbol), '股指期权K线失败');
  }
  /** ETF 期权各月合约列表。cate: '50ETF' | '300ETF' | '500ETF' | '科创50' | '科创板50' */
  async getOptionEtfMonths(cate: '50ETF' | '300ETF' | '500ETF' | '科创50' | '科创板50') {
    return this.guard(this.sdk.options.etf.months(cate), 'ETF期权合约月份失败');
  }
  /** ETF 期权某到期日合约列表。cate + month（YYYY-MM） */
  async getOptionEtfExpireDay(cate: '50ETF' | '300ETF' | '500ETF' | '科创50' | '科创板50', month: string) {
    return this.guard(this.sdk.options.etf.expireDay(cate, month), 'ETF期权到期合约失败');
  }
  /** ETF 期权分钟 K 线。code 如 '10004336' */
  async getOptionEtfMinuteKline(code: string) {
    return this.guard(this.sdk.options.etf.minute(code), 'ETF期权分钟K线失败');
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
  /** 中金所期权实时行情列表（分页） */
  async getOptionCffexQuotes(opts?: { pageSize?: number }) {
    return this.guard(this.sdk.options.cffex.quotes(opts ?? {}), '中金所期权实时失败');
  }
  /** 期权龙虎榜。symbol 如 '10004336'，date 形如 '2024-08-08' */
  async getOptionLhb(symbol: string, date: string) {
    return this.guard(this.sdk.options.lhb(symbol, date), '期权龙虎榜失败');
  }

  // -------- 期货：国内 / 全球 K 线、库存品种与库存数据 --------
  /** 国内期货 K 线。symbol 如 'MA0' / 'rb2410'；日期 YYYYMMDD */
  async getFuturesKline(symbol: string, opts?: { period?: 'daily' | 'weekly' | 'monthly'; startDate?: string; endDate?: string }) {
    return this.guard(this.sdk.futures.kline(symbol, opts ?? {}), '期货K线失败');
  }
  /** 全球期货 K 线。symbol 如 'GLNC' / 'CL'；日期 YYYYMMDD */
  async getFuturesGlobalKline(symbol: string, opts?: { period?: 'daily' | 'weekly' | 'monthly'; startDate?: string; endDate?: string; marketCode?: number }) {
    return this.guard(this.sdk.futures.globalKline(symbol, opts ?? {}), '全球期货K线失败');
  }
  /** 期货库存品种列表 */
  async getFuturesInventorySymbols() {
    return this.guard(this.sdk.futures.inventorySymbols(), '期货库存品种失败');
  }
  /** 期货库存数据。symbol 如 'CU'；日期 YYYY-MM-DD */
  async getFuturesInventory(symbol: string, opts?: { startDate?: string; pageSize?: number }) {
    return this.guard(this.sdk.futures.inventory(symbol, opts ?? {}), '期货库存数据失败');
  }
  /** COMEX 库存数据。symbol 仅 'gold' | 'silver' */
  async getFuturesComexInventory(symbol: 'gold' | 'silver', opts?: { pageSize?: number }) {
    return this.guard(this.sdk.futures.comexInventory(symbol, opts ?? {}), 'COMEX库存数据失败');
  }

  /** 交易日判断 */
  async isTradingDay(date?: string | Date): Promise<boolean> {
    return this.guard(this.sdk.calendar.isTradingDay(date), '交易日判断失败');
  }
  /** 下一交易日 */
  async nextTradingDay(date?: string | Date): Promise<string> {
    return this.guard(this.sdk.calendar.nextTradingDay(date), '下一交易日失败');
  }
  /** 上一交易日 */
  async prevTradingDay(date?: string | Date): Promise<string> {
    return this.guard(this.sdk.calendar.prevTradingDay(date), '上一交易日失败');
  }
  /** 市场状态（同步） */
  getMarketStatus(market: 'A' | 'HK' | 'US' = 'A'): string {
    return this.sdk.calendar.marketStatus(market);
  }
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
  return {
    symbol,
    last: num(r.price),
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
  return {
    symbol,
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
  const market: Instrument['market'] =
    r.market === 'HK' ? 'HK' : r.market === 'US' ? 'US' : 'A';
  const code = String(r.code ?? '');
  return {
    symbol: { code, exchange: exchangeOf(r.market ?? 'CN', code), name: String(r.name ?? '') },
    name: String(r.name ?? ''),
    market,
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
