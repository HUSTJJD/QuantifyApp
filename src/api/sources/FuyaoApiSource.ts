/**
 * FuyaoApiSource —— 基于官方 SDK @opptrix/fuyao 的同花顺金融数据主源（id: fuyao）。
 *
 * 这是对旧手写 HithsaApiSource 的**全量替换**：不再手拼 URL/query、手解信封，
 * 全部改用 SDK 的类型化资源方法（client.meta / client.aShare.* / client.index.* /
 * client.specialData.* / client.funds.*），由 SDK 统一负责：
 *  - 拼接 URL 与 query 序列化（自动跳过 undefined/null）
 *  - 注入 X-api-key 认证头
 *  - 请求超时控制
 *  - 统一信封解析与业务错误抛出（code!==0 -> FuyaoApiError）
 *  - 全局限速（intervalMs，防 QPS 触发 4001）
 *
 * API Key 策略（用户已确认）：**构造时读取一次默认 Key（优先用户自设，其次统一环境变量
 * HITHINK_FINANCE_API_KEY），用户改 Key 后需重启 App 生效**（SDK 的 apiKey 为构造时 readonly，
 * 不做运行时热更新）。
 *
 * 设计原则：
 *  - 严格实现 MarketDataSource 接口：方法签名、返回类型必须与接口一致；
 *  - SDK 不支持的周期（分钟级）与能力（A 股五档盘口）统一抛 DataSourceError(3004)，
 *    由 MarketDataClient 路由到 stock-sdk / stock-api 兜底；
 *  - 字段命名：SDK 返回 snake_case，本文件统一归一化为 types 中的 camelCase；
 *  - 每个端点失败统一归一化为 DataSourceError（携带上游 code 与 retryable）。
 */
import { FuyaoClient, FuyaoApiError, FuyaoHttpError, FuyaoTimeoutError } from '@opptrix/fuyao';
import { DataSourceError } from '../MarketDataSource';
import type { DataSourceMethod } from '../MarketDataSource';
import type { CapabilitySpec } from '../capability';
import { BaseMarketDataSource } from './BaseMarketDataSource';
import type {
  AdjustmentFactor,
  AnomalyStock,
  Candle,
  DragonTigerList,
  DragonTigerStock,
  DragonTigerHotMoney,
  FundHolder,
  FundHolding,
  FundNav,
  FundNavRange,
  FundNavType,
  FundMergeScope,
  FundProfile,
  FundReturn,
  FundType,
  HotStock,
  IndexConstituent,
  IndexInfo,
  IndexTag,
  Instrument,
  KlinePeriod,
  KlineParams,
  LadderBoardKey,
  LadderDay,
  LadderStock,
  LimitBreakStock,
  LimitDownStock,
  LimitUpLadder,
  LimitUpStock,
  AuctionSnapshot,
  AuctionSnapshotParams,
  ShortTermBenchmark,
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
  FinancialIndicator,
  FinancialReport,
  ProfitForecast,
  HistoricalFinancialParams,
  IndicatorsParams,
  Exchange,
  AssetType,
} from '../types';
import { toThsCode, fromThsCode, marketOf, parseSymbol } from '@/domain/symbol';
import { cleanCandles } from '../candleValidity';
import { register } from '../DataSourceRegistry';
import { HithsaHttpClient } from './HithsaHttpClient';

export const FUYAO_SOURCE_ID = 'fuyao';
export const FUYAO_SOURCE_NAME = '同花顺(SDK)';

/** 本项目周期 -> SDK interval */
const PERIOD_TO_INTERVAL: Record<string, string> = {
  day: '1d',
  week: '1w',
  month: '1mo',
};
/** 本项目复权 -> SDK adjust */
const ADJUST_TO_SDK: Record<string, 'none' | 'forward' | 'backward'> = {
  none: 'none',
  forward: 'forward',
  backward: 'backward',
};
/** SDK 支持的本项目周期集合 */
const SDK_PERIODS = new Set<KlinePeriod>(['day', 'week', 'month']);

/** SDK 时间窗口硬限制：end - start 最多 10 年 */
const MAX_HIST_SPAN_MS = 10 * 365 * 24 * 3600 * 1000;

function num(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

function toMs(raw: number): number {
  return Number.isFinite(raw) ? raw : Date.now();
}

function toInstrument(item: { thscode?: string; ticker?: string; name?: string; exchange?: string | null; asset_type?: string; currency?: string }): Instrument {
  const symbol = fromThsCode(item.thscode ?? item.ticker ?? '');
  return {
    symbol,
    name: item.name ?? '',
    market: marketOf(symbol.exchange),
    assetType: item.asset_type as Instrument['assetType'],
    currency: item.currency ?? undefined,
  };
}

function sdkAdjust(kline: KlineParams): 'none' | 'forward' | 'backward' {
  return ADJUST_TO_SDK[kline.adjust ?? 'forward'] ?? 'forward';
}

/** 从 KlineParams 推导 [startMs, endMs]（SDK 必填毫秒，且窗口 ≤10 年） */
function resolveRange(params: KlineParams): { start: number; end: number } {
  const endMs = params.endMs ?? Date.now();
  const dailyCount =
    params.period === 'day'
      ? (params.count ?? 240)
      : Math.max(params.count ?? 240, 1) * (params.period === 'week' ? 7 : 31);
  let startMs = params.startMs ?? endMs - dailyCount * 24 * 3600 * 1000;
  startMs = Math.max(startMs, endMs - MAX_HIST_SPAN_MS);
  return { start: startMs, end: endMs };
}

function toCandle(d: { date_ms?: number; open_price?: number; high_price?: number; low_price?: number; close_price?: number; volume?: number; turnover?: number }): Candle {
  const open = num(d.open_price) ?? 0;
  const high = num(d.high_price) ?? 0;
  const low = num(d.low_price) ?? 0;
  const close = num(d.close_price) ?? 0;
  return {
    datetime: toMs(d.date_ms ?? 0),
    open,
    high,
    low,
    close,
    volume: num(d.volume) ?? 0,
    amount: num(d.turnover) ?? undefined,
  };
}

export class FuyaoApiSource extends BaseMarketDataSource {
  readonly id = FUYAO_SOURCE_ID;
  readonly label = FUYAO_SOURCE_NAME;

  /** 同花顺官方 SDK 覆盖的全部能力（沪深 A 股为主；参数级限制见 supports）——强类型：DataSourceMethod */
  // 注：不声明 getOrderBook —— 本源实现体是 3004（同花顺官方 SDK 当前不给 A 股五档），
  // 声明了只会让 SourceRouter 白白先试一次再降级；盘口由 stock-sdk 兜底。
  readonly capabilities: ReadonlySet<DataSourceMethod> = new Set([
    'listTickers', 'search', 'getQuotes', 'getKline',
    'getValuations', 'getIncomeStatements', 'getBalanceSheets', 'getCashFlowStatements',
    'getFinancialIndicators', 'getFinancials',
    'getAdjustmentFactors', 'listIndices', 'getIndexConstituents', 'getIndexQuotes',
    'getIndexKline', 'getFundProfile', 'getFundHoldings', 'getFundNav', 'getFundReturns',
    'getFundHolders', 'getFundMarketSnapshot', 'getFundHistorical',
    'getLimitUpPool', 'getLimitUpLadder', 'getLimitDownPool', 'getLimitBreakPool',
    'getAnomalyList', 'getAnomalyByStocks',
    'getAuctionSnapshot', 'getShortTermBenchmark',
    'getSkyrocketList', 'getHotStockList', 'getHotStockListHistory', 'getHotStockRankTrend',
    'getDragonTigerList', 'getTradingDays',
  ]);

  private client: FuyaoClient | null = null;
  private key: string | undefined;

  /** 默认 Key 解析来源（可注入便于测试）。 */
  private readonly keyProvider: () => string | undefined;

  constructor(keyProvider?: () => string | undefined) {
    super();
    this.keyProvider = keyProvider ?? (() => HithsaHttpClient.resolveUnifiedKey());
  }

  async init(): Promise<void> {
    // 懒构造：首次 get() 时再建 client（以便 Key 在 App 启动 applyUserPreferences 后已就绪）
    return;
  }

  async dispose(): Promise<void> {
    this.client = null;
  }

  /** 获取 SDK client；首次调用时懒构造（读一次默认 Key）。未配置 Key 抛错 */
  private get(): FuyaoClient {
    if (!this.client) {
      this.key = this.keyProvider();
      if (!this.key) {
        throw new DataSourceError('缺少同花顺 API Key（请重启应用生效）', FUYAO_SOURCE_ID, 2001);
      }
      this.client = new FuyaoClient({
        apiKey: this.key,
        // 全局限速约 3 QPS，避免触发 4001 限频
        intervalMs: 350,
        timeoutMs: 20000,
      });
    }
    return this.client;
  }

  /** 归一化 SDK 错误为 DataSourceError（保留 retryable 语义） */
  private guard<T>(p: Promise<T>, msg: string): Promise<T> {
    return p.catch((e: unknown) => {
      if (e instanceof FuyaoApiError) {
        throw new DataSourceError(e.message || msg, FUYAO_SOURCE_ID, e.code, e);
      }
      if (e instanceof FuyaoTimeoutError) {
        throw new DataSourceError(msg, FUYAO_SOURCE_ID, 5002, e);
      }
      if (e instanceof FuyaoHttpError) {
        throw new DataSourceError(msg, FUYAO_SOURCE_ID, e.status, e);
      }
      if (e instanceof DataSourceError) throw e;
      throw new DataSourceError(msg, FUYAO_SOURCE_ID, undefined, e);
    });
  }

  private toQuote(symbol: Symbol, d: {
    last_price?: number; prev_price?: number; open_price?: number; high_price?: number;
    low_price?: number; volume?: number; turnover?: number; price_change?: number;
    price_change_ratio_pct?: number;
  }): Quote {
    const last = num(d.last_price) ?? 0;
    const prevClose = num(d.prev_price) ?? 0;
    const open = num(d.open_price) ?? 0;
    const high = num(d.high_price) ?? 0;
    const low = num(d.low_price) ?? 0;
    const change = num(d.price_change) ?? last - prevClose;
    const changePct = num(d.price_change_ratio_pct) ?? (prevClose ? (change / prevClose) * 100 : 0);
    return {
      symbol,
      last,
      prevClose,
      open,
      high,
      low,
      volume: num(d.volume) ?? 0,
      amount: num(d.turnover) ?? 0,
      change,
      changePct,
      amplitudePct: prevClose ? ((high - low) / prevClose) * 100 : 0,
    };
  }

  // ===================== 元信息 =====================
  async search(params: SearchParams): Promise<Instrument[]> {
    const res = await this.guard(
      this.get().meta.search({
        q: params.keyword,
        exchange: params.exchange,
        assetType: params.assetType as never,
        limit: 50,
      }),
      '同花顺标的检索失败',
    );
    return (res.data?.item ?? []).map(toInstrument);
  }

  async listTickers(opts?: { exchange?: Exchange; assetType?: AssetType; limit?: number; offset?: number }): Promise<Instrument[]> {
    const res = await this.guard(
      this.get().meta.listTickers({
        // fuyao AssetType 子集与本项目联合不完全对齐，运行时原样透传
        assetType: opts?.assetType as never,
        limit: opts?.limit ?? 1000,
        offset: opts?.offset,
      }),
      '同花顺标的列表失败',
    );
    return (res.data?.item ?? []).map(toInstrument);
  }

  // ===================== 行情 =====================

  /**
   * 参数级能力规格（声明式数据表，由 capability.ts 通用引擎统一决策）：
   *  - 官方 SDK 仅覆盖沪深 A 股（SH/SZ）：
   *    北交所 BJ 会被服务端拒绝（Unknown thscode）、港股 HK / 美股 US 超出官方范围；
   *    涉及非 SH/SZ 标的的请求由路由层裁剪并走 stock-sdk 兜底，避免无谓的 ERROR 日志。
   *  - K 线周期限 day / week / month（SDK 仅支持日/周/月，分钟K 由兜底源覆盖）；
   *  - 指数端点代码体系另支持 .TI（同花顺板块指数，endpoints-index 契约）。
   */
  protected readonly spec: CapabilitySpec = {
    klinePeriods: [...SDK_PERIODS],
    singleSymbolExchanges: ['SH', 'SZ'],
    batchExchanges: ['SH', 'SZ'],
    indexExchanges: ['SH', 'SZ', 'TI'],
  };

  async getQuotes(symbols: Symbol[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];
    const codes = symbols.map(toThsCode).join(',');
    const res = await this.guard(
      this.get().aShare.prices.snapshot({ thscodes: codes }),
      `同花顺行情快照失败:${codes}`,
    );
    const byCode = new Map<string, Quote>();
    for (const item of res.data?.item ?? []) {
      byCode.set(item.thscode, this.toQuote(fromThsCode(item.thscode), item));
    }
    return symbols.map((s) => byCode.get(toThsCode(s))).filter((q): q is Quote => !!q);
  }

  async getOrderBook(_symbol: Symbol): Promise<OrderBook> {
    throw new DataSourceError('fuyao 不支持 A 股五档盘口', FUYAO_SOURCE_ID, 3004);
  }

  async getKline(params: KlineParams): Promise<Candle[]> {
    if (!SDK_PERIODS.has(params.period)) {
      throw new DataSourceError(`fuyao 不支持周期 ${params.period}`, FUYAO_SOURCE_ID, 3004);
    }
    const { start, end } = resolveRange(params);
    const res = await this.guard(
      this.get().aShare.prices.historical({
        thscode: toThsCode(params.symbol),
        interval: PERIOD_TO_INTERVAL[params.period] as '1d' | '1w' | '1mo',
        start,
        end,
        adjust: sdkAdjust(params),
      }),
      '同花顺历史K线失败',
    );
    return cleanCandles((res.data?.item ?? []).map(toCandle));
  }

  async getAdjustmentFactors(symbol: Symbol, from?: string, to?: string): Promise<AdjustmentFactor[]> {
    const res = await this.guard(
      this.get().aShare.corporateActions.adjustmentFactors({
        thscode: toThsCode(symbol),
        from,
        to,
      }),
      '同花顺复权因子失败',
    );
    return (res.data?.item ?? []).map((it) => {
      // SDK 类型定义缺少配股字段，但官方端点实际会返回；
      // 以交叉类型窄化保留运行时透传，避免类型缺口。
      const raw = it as typeof it & { allotment_ratio?: number; allotment_price?: number };
      return {
        symbol,
        ticker: fromThsCode(res.data!.thscode ?? toThsCode(symbol)).code,
        exDateMs: toMs(it.ex_date_ms),
        dividendPerShare: num(it.dividend_per_share),
        perShareBonus: num(it.per_share_bonus),
        allotmentRatio: num(raw.allotment_ratio),
        allotmentPrice: num(raw.allotment_price),
      };
    });
  }

  // ===================== 估值 =====================
  async getValuations(symbols: Symbol[]): Promise<Valuation[]> {
    if (symbols.length === 0) return [];
    const res = await this.guard(
      this.get().aShare.valuations.snapshot({ thscodes: symbols.map(toThsCode).join(',') }),
      '同花顺估值快照失败',
    );
    const ts = res.data?.timestamp ?? null;
    return (res.data?.item ?? []).map((it) => ({
      symbol: fromThsCode(it.thscode),
      name: it.name,
      peTtm: it.pe_ttm,
      peMrq: it.pe_mrq,
      pbMrq: it.pb_mrq,
      psTtm: it.ps_ttm,
      pcfTtm: it.pcf_ttm,
      timestamp: ts,
    }));
  }

  // ===================== 财务 =====================
  private static reportPeriod(p: FinancialStatementPeriod): 'annual' | 'quarterly' {
    return p;
  }

  async getIncomeStatements(params: HistoricalFinancialParams): Promise<IncomeStatement[]> {
    const res = await this.guard(
      this.get().aShare.financials.incomeStatements({
        thscode: toThsCode(params.symbol),
        period: params.period,
        limit: params.limit,
        start: params.startMs,
        end: params.endMs,
      }),
      '同花顺利润表失败',
    );
    return (res.data?.item ?? []).map((d) => ({
      symbol: params.symbol,
      period: FuyaoApiSource.reportPeriod(d.period),
      periodEndMs: d.period_end_ms,
      reportDateMs: d.report_date_ms,
      fiscalYear: d.fiscal_year,
      fiscalPeriod: d.fiscal_period,
      currency: d.currency,
      basicEps: d.basic_eps,
      operatingIncome: d.operating_income,
      operatingCosts: d.operating_costs,
      operatingExpenses: d.operating_expenses,
      operatingProfit: d.operating_profit,
      profitTotal: d.profit_total,
      netProfit: d.net_profit,
      parentHolderNetProfit: d.parent_holder_net_profit,
      incomeTaxExpense: d.income_tax_expense,
      interestExpenses: d.interest_expenses,
      manageFee: d.manage_fee,
      salesFee: d.sales_fee,
      researchAndDevelopmentExpenses: d.research_and_development_expenses,
    }));
  }

  async getBalanceSheets(params: HistoricalFinancialParams): Promise<BalanceSheet[]> {
    const res = await this.guard(
      this.get().aShare.financials.balanceSheets({
        thscode: toThsCode(params.symbol),
        period: params.period,
        limit: params.limit,
        start: params.startMs,
        end: params.endMs,
      }),
      '同花顺资产负债表失败',
    );
    return (res.data?.item ?? []).map((d) => ({
      symbol: params.symbol,
      period: FuyaoApiSource.reportPeriod(d.period),
      periodEndMs: d.period_end_ms,
      reportDateMs: d.report_date_ms,
      fiscalYear: d.fiscal_year,
      fiscalPeriod: d.fiscal_period,
      currency: d.currency,
      totalCurrentAssets: d.total_current_assets,
      nonCurrentNetsTotal: d.non_current_nets_total,
      assetsTotal: d.assets_total,
      totalDebt: d.total_debt,
      holderEquityTotal: d.holder_equity_total,
      cash: d.cash,
      accountsReceivable: d.accounts_receivable,
    }));
  }

  async getCashFlowStatements(params: HistoricalFinancialParams): Promise<CashFlowStatement[]> {
    const res = await this.guard(
      this.get().aShare.financials.cashFlowStatements({
        thscode: toThsCode(params.symbol),
        period: params.period,
        limit: params.limit,
        start: params.startMs,
        end: params.endMs,
      }),
      '同花顺现金流量表失败',
    );
    return (res.data?.item ?? []).map((d) => ({
      symbol: params.symbol,
      period: FuyaoApiSource.reportPeriod(d.period),
      periodEndMs: d.period_end_ms,
      reportDateMs: d.report_date_ms,
      fiscalYear: d.fiscal_year,
      fiscalPeriod: d.fiscal_period,
      currency: d.currency,
      actCashFlowNet: d.act_cash_flow_net,
      investCashFlowNet: d.invest_cash_flow_net,
      financingCashFlowNet: d.financing_cash_flow_net,
      cashEquivalentsNetAddition: d.cash_equivalents_net_addition,
      payDividendsProfitsInterestCash: d.pay_dividends_profits_interest_cash,
      payFixedAssetsEtcCash: d.pay_fixed_assets_etc_cash,
    }));
  }

  async getFinancialIndicators(params: IndicatorsParams): Promise<FinancialIndicator[]> {
    const res = await this.guard(
      this.get().aShare.financials.indicators({
        thscode: toThsCode(params.symbol),
        report: params.report ?? '',
      }),
      '同花顺财务指标失败',
    );
    const out: FinancialIndicator[] = [];
    for (const block of res.data?.abilities ?? []) {
      for (const ind of block.indicators ?? []) {
        out.push({ category: block.ability as FinancialIndicator['category'], indexId: ind.index_id, value: ind.value });
      }
    }
    return out;
  }

  // ------------------------- 财务汇总（getFinancials） -------------------------
  // MarketDataClient 通过 runWithFallback('getFinancials', code) 调用；
  // latestReport 所需的指标（eps / 营收 / 净利 / 总资产 / 净资产 / 经营现金流）
  // 分散在三大报表中，这里按报告期(periodEndMs)合并成统一的 FinancialReport[]。
  async getFinancials(code: string): Promise<FinancialReport[]> {
    const symbol = parseSymbol(code);
    const params: HistoricalFinancialParams = { symbol, period: 'annual', limit: 4 };
    const [income, balance, cash] = await Promise.all([
      this.getIncomeStatements(params).catch(() => [] as IncomeStatement[]),
      this.getBalanceSheets(params).catch(() => [] as BalanceSheet[]),
      this.getCashFlowStatements(params).catch(() => [] as CashFlowStatement[]),
    ]);

    const byPeriod = new Map<number, FinancialReport>();
    const ensure = (ms: number): FinancialReport => {
      let r = byPeriod.get(ms);
      if (!r) {
        r = { periodEndMs: ms };
        byPeriod.set(ms, r);
      }
      return r;
    };

    for (const s of income) {
      const r = ensure(s.periodEndMs ?? 0);
      r.symbol = s.symbol;
      r.period = s.period;
      r.basicEps = s.basicEps;
      r.operatingIncome = s.operatingIncome;
      r.operatingCosts = s.operatingCosts;
      r.netProfit = s.netProfit;
      r.parentHolderNetProfit = s.parentHolderNetProfit;
    }
    for (const b of balance) {
      const r = ensure(b.periodEndMs ?? 0);
      r.totalAssets = b.assetsTotal;
      r.holderEquityTotal = b.holderEquityTotal;
    }
    for (const c of cash) {
      const r = ensure(c.periodEndMs ?? 0);
      r.operatingCashFlow = c.actCashFlowNet;
    }

    return Array.from(byPeriod.values())
      .filter((r) => Boolean(r.periodEndMs))
      .sort((a, b) => (b.periodEndMs ?? 0) - (a.periodEndMs ?? 0));
  }

  async getProfitForecast(_code: string): Promise<never> {
    // 同花顺官方契约未提供盈利预测端点：明确 3004，避免"返回空数组冒充成功"
    return this.unsupported('getProfitForecast');
  }

  /**
   * 炸板池 —— 曾涨停后打开的股票。
   * ── 上游：SDK specialData.limitBreakPool({ dateMs?, page?, size? })
   */
  async getLimitBreakPool(opts?: { dateMs?: number; page?: number; size?: number }): Promise<ListResult<LimitBreakStock>> {
    const res = await this.guard(
      this.get().specialData.limitBreakPool({
        dateMs: opts?.dateMs,
        page: opts?.page,
        size: opts?.size,
      }),
      '同花顺炸板池失败',
    );
    return {
      items: (res.data?.item ?? []).map((d) => ({
        symbol: fromThsCode(d.thscode),
        name: d.name,
        lastPrice: d.last_price,
        changePct: d.price_change_ratio_pct,
        openTimes: d.open_times ?? null,
        turnoverRatioPct: d.turnover_ratio_pct ?? null,
        turnover: d.turnover ?? null,
      })),
    };
  }

  /**
   * 集合竞价快照。
   * ── 上游：SDK auction.snapshot({ thscodes, stage? })
   * ── stage: live=实时 / final=终态（默认）
   */
  async getAuctionSnapshot(params: AuctionSnapshotParams): Promise<AuctionSnapshot[]> {
    if (params.symbols.length === 0) return [];
    const res = await this.guard(
      this.get().aShare.auction.snapshot({
        thscodes: params.symbols.map(toThsCode).join(','),
        stage: params.stage,
      }),
      '集合竞价快照失败',
    );
    return (res.data?.item ?? []).map((d) => ({
      symbol: fromThsCode(d.thscode),
      name: d.name,
      auctionPrice: d.auction_price ?? null,
      auctionPct: d.auction_pct ?? null,
      auctionVolume: d.auction_volume ?? null,
      auctionAmount: d.auction_amount ?? null,
      auctionUnmatched: d.auction_unmatched ?? null,
      auctionTurnoverPct: d.auction_turnover_pct ?? null,
      preClosePrice: d.pre_close_price ?? null,
      openPrice: d.open_price ?? null,
      lastPrice: d.last_price ?? null,
      floatMarketCap: d.float_market_cap ?? null,
    }));
  }

  /** 短线风向标竞价基准 */
  async getShortTermBenchmark(date?: string): Promise<ShortTermBenchmark[]> {
    const res = await this.guard(
      this.get().aShare.auction.shortTermBenchmark(date ? { date } : undefined),
      '短线风向标失败',
    );
    return (res.data?.item ?? []).map((d) => ({
      symbol: fromThsCode(d.thscode),
      name: d.name,
      auctionPct: d.auction_pct ?? null,
      tags: d.tags ?? [],
    }));
  }

  /**
   * 跌停池 —— 与 getLimitUpPool 对称。
   * ── 上游：SDK specialData.limitDownPool({ dateMs?, page?, size? })
   * ── 字段：thscode/name/last_price/price_change_ratio_pct/first_limit_time/last_limit_time/turnover_ratio_pct
   */
  async getLimitDownPool(opts?: { dateMs?: number; page?: number; size?: number }): Promise<ListResult<LimitDownStock>> {
    const res = await this.guard(
      this.get().specialData.limitDownPool({
        dateMs: opts?.dateMs,
        page: opts?.page,
        size: opts?.size,
      }),
      '同花顺跌停池失败',
    );
    return {
      items: (res.data?.item ?? []).map((d) => ({
        symbol: fromThsCode(d.thscode),
        name: d.name,
        lastPrice: d.last_price,
        changePct: d.price_change_ratio_pct,
        firstLimitTime: d.first_limit_time ?? undefined,
        lastLimitTime: d.last_limit_time ?? undefined,
        turnoverRatioPct: d.turnover_ratio_pct ?? null,
      })),
    };
  }

  // ===================== 指数 / 板块 =====================
  async listIndices(tag?: IndexTag): Promise<IndexInfo[]> {
    const res = await this.guard(
      this.get().index.catalogThsIndexList({ tag: tag as never }),
      '同花顺指数列表失败',
    );
    return (res.data?.item ?? []).map((it) => {
      const symbol = fromThsCode(it.thscode);
      return { symbol: { ...symbol, name: it.name }, name: it.name };
    });
  }

  async getIndexConstituents(symbol: Symbol): Promise<IndexConstituent[]> {
    const res = await this.guard(
      this.get().index.constituentsThsStockList({ thscode: toThsCode(symbol) }),
      '同花顺指数成分失败',
    );
    return (res.data?.item ?? []).map((it) => {
      const s = fromThsCode(it.thscode);
      return { symbol: { ...s, name: it.name }, name: it.name };
    });
  }

  async getIndexQuotes(symbols: Symbol[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];
    const res = await this.guard(
      this.get().index.pricesSnapshot({ thscodes: symbols.map(toThsCode).join(',') }),
      '同花顺指数快照失败',
    );
    const byCode = new Map<string, Quote>();
    for (const item of res.data?.item ?? []) byCode.set(item.thscode, this.toQuote(fromThsCode(item.thscode), item));
    return symbols.map((s) => byCode.get(toThsCode(s))).filter((q): q is Quote => !!q);
  }

  async getIndexKline(params: KlineParams): Promise<Candle[]> {
    if (params.period !== 'day') {
      throw new DataSourceError(`fuyao 指数K线仅支持日线`, FUYAO_SOURCE_ID, 3004);
    }
    const { start, end } = resolveRange(params);
    const res = await this.guard(
      this.get().index.pricesHistorical({
        thscode: toThsCode(params.symbol),
        start,
        end,
      }),
      '同花顺指数历史K线失败',
    );
    return cleanCandles((res.data?.item ?? []).map(toCandle));
  }

  // ===================== 基金 =====================
  async getFundProfile(symbol: Symbol, fundType: FundType): Promise<FundProfile> {
    const res = await this.guard(
      this.get().funds.profile.detail({ fundType, thscode: toThsCode(symbol) }),
      '同花顺基金档案失败',
    );
    const d = res.data?.item?.[0];
    return {
      symbol,
      ticker: fromThsCode(d?.thscode ?? toThsCode(symbol)).code,
      fundName: d?.fund_name ?? null,
      estabDateMs: d?.estab_date ?? null,
      mgmtName: d?.mgmt_name ?? null,
      managerName: d?.manager_name ?? null,
    };
  }

  async getFundHoldings(symbol: Symbol, fundType: FundType): Promise<FundHolding[]> {
    const res = await this.guard(
      this.get().funds.portfolio.holdings({ fundType, thscode: toThsCode(symbol) }),
      '同花顺基金持仓失败',
    );
    return (res.data?.item ?? []).map((d) => ({
      symbol,
      ticker: d.ticker ?? fromThsCode(d.thscode ?? toThsCode(symbol)).code,
      stockName: d.stock_name ?? '',
      holdRatio: d.hold_ratio ?? 0,
    }));
  }

  async getFundNav(symbol: Symbol, fundType: FundType, range?: FundNavRange, navType?: FundNavType): Promise<FundNav[]> {
    const res = await this.guard(
      this.get().funds.performance.nav({
        fundType,
        thscode: toThsCode(symbol),
        range,
        navType,
      }),
      '同花顺基金净值失败',
    );
    return (res.data?.item ?? []).map((d) => ({
      symbol,
      navDate: new Date(toMs(d.nav_date)).toISOString().slice(0, 10),
      unitNav: d.unit_nav ?? null,
      adjNav: d.adj_nav ?? null,
    }));
  }

  async getFundReturns(symbol: Symbol, fundType: FundType): Promise<FundReturn> {
    const res = await this.guard(
      this.get().funds.performance.returns({ fundType, thscode: toThsCode(symbol) }),
      '同花顺基金回报失败',
    );
    const d = res.data?.item?.[0] ?? {};
    return {
      symbol,
      returnMonth: d.return_month ?? null,
      returnTmonth: d.return_tmonth ?? null,
      returnHyar: d.return_hyear ?? null,
      returnYear: d.return_year ?? null,
      returnTyear: d.return_tyear ?? null,
      returnFyear: d.return_fyear ?? null,
      returnNowYear: d.return_nowyear ?? null,
      returnNow: d.return_now ?? null,
    };
  }

  async getFundHolders(symbol: Symbol, fundType: FundType, mergeScope?: FundMergeScope): Promise<FundHolder[]> {
    const res = await this.guard(
      this.get().funds.holders.detail({ fundType, thscode: toThsCode(symbol), mergeScope }),
      '同花顺基金份额持有人失败',
    );
    return (res.data?.item ?? []).map((d) => ({
      symbol,
      mergeScope: d.merge_scope === 'separate' ? 'separate' : 'merged',
      reportDateMs: toMs(d.report_date_ms ?? 0),
      insPosition: num(d.ins_position) ?? null,
      holderAmount: num(d.holder_amount) ?? null,
      avgHolderShare: num(d.avg_holder_share) ?? null,
      psnlRate: num(d.psnl_rate) ?? null,
      mgmtStaffHoldRate: num(d.mgmt_staff_hold_rate) ?? null,
    }));
  }

  async getFundMarketSnapshot(symbol: Symbol): Promise<Quote> {
    const res = await this.guard(
      this.get().funds.market.snapshot({ thscode: toThsCode(symbol) }),
      '同花顺基金行情失败',
    );
    const d = res.data?.item?.[0];
    if (!d) throw new DataSourceError('同花顺基金行情无数据', FUYAO_SOURCE_ID, 3001);
    return this.toQuote(symbol, d);
  }

  async getFundHistorical(symbol: Symbol, startMs: number, endMs: number): Promise<Candle[]> {
    const res = await this.guard(
      this.get().funds.market.historical({ thscode: toThsCode(symbol), start: startMs, end: endMs }),
      '同花顺基金历史失败',
    );
    return cleanCandles((res.data?.item ?? []).map(toCandle));
  }

  // ===================== 特色数据 =====================
  async getLimitUpPool(opts?: { dateMs?: number; page?: number; size?: number; sortField?: string; sortDir?: string }): Promise<ListResult<LimitUpStock>> {
    const res = await this.guard(
      this.get().specialData.limitUpPool({
        dateMs: opts?.dateMs,
        page: opts?.page,
        size: opts?.size,
        sortField: opts?.sortField as never,
        sortDir: opts?.sortDir as never,
      }),
      '同花顺涨停池失败',
    );
    return {
      items: (res.data?.item ?? []).map((d) => ({
        symbol: fromThsCode(d.thscode),
        name: d.name,
        isSt: Boolean(d.is_st),
        isNew: Boolean(d.is_new),
        lastPrice: d.last_price,
        changePct: d.price_change_ratio_pct,
        limitUpTime: d.limit_up_time ?? '',
        limitUpReason: d.limit_up_reason ?? '',
        continueDayText: d.continue_day_text ?? '',
        continueDayCnt: d.continue_day_cnt,
        sealMoney: d.seal_money,
        maxSealMoney: d.max_seal_money,
      })),
    };
  }

  /**
   * 连板天梯 —— 近 N 个交易日 × 板位矩阵。
   *
   * ── 传输协议 ──────────────────────────
   * 上游：SDK specialData.limitUpLadder() → GET /api/a-share/special-data/limit-up-ladder
   * 编码：JSON；批量：无参固定窗口
   *
   * ── 响应（源字段）──────────────────────
   * | 字段 | 类型 | 说明 |
   * | timestamp | number | 上游时间戳 |
   * | window.length | number | 窗口交易日数 |
   * | window.date_list | string[] | 窗口日期（yyyyMMdd） |
   * | window.board_caps | Partial<Record<LadderBoardKey, number>> | 各板位上限 |
   * | item[].date | string | 交易日 yyyyMMdd |
   * | item[].boards | Record<LadderBoardKey, LadderStockItem[]> | 板位→股票列表 |
   * | boards.*[].thscode/ticker/name | string | 标的标识与名称 |
   * | boards.*[].board_num | number | 连板数 |
   * | boards.*[].seal_nextday | boolean\|null | 次日是否续封（最近交易日为 null） |
   * | boards.*[].sign_level | number | 标记等级 |
   *
   * ── 映射到统一类型 ────────────────────
   * item → LimitUpLadder.days；window → LimitUpLadder.window（date_list→dateList）
   * thscode → Symbol；board_num→boardNum；seal_nextday→sealNextDay；sign_level→signLevel
   *
   * ── 失败与降级 ────────────────────────
   * 业务/网络错误包装为 DataSourceError；本源不支持时由上游 code 表达
   */
  async getLimitUpLadder(): Promise<LimitUpLadder> {
    const res = await this.guard(this.get().specialData.limitUpLadder(), '同花顺连板梯队失败');
    const d = res.data;
    if (!d) {
      return {
        timestamp: 0,
        window: { length: 0, dateList: [], boardCaps: {} },
        days: [],
      };
    }
    const mapStock = (s: { thscode?: string; ticker?: string; name?: string; board_num?: number; seal_nextday?: boolean | null; sign_level?: number }): LadderStock => ({
      symbol: fromThsCode(s.thscode ?? s.ticker ?? ''),
      name: s.name ?? '',
      boardNum: s.board_num ?? 0,
      sealNextDay: s.seal_nextday ?? null,
      signLevel: s.sign_level ?? 0,
    });
    const mapBoards = (boards: Record<string, unknown[]> | undefined): Record<LadderBoardKey, LadderStock[]> => {
      const empty = {} as Record<LadderBoardKey, LadderStock[]>;
      for (const k of ['two_board', 'three_board', 'four_board', 'five_board', 'six_board', 'seven_over'] as LadderBoardKey[]) {
        empty[k] = [];
      }
      if (!boards) return empty;
      for (const k of Object.keys(empty) as LadderBoardKey[]) {
        const list = boards[k];
        if (Array.isArray(list)) {
          empty[k] = list.map((s) => mapStock(s as Parameters<typeof mapStock>[0]));
        }
      }
      return empty;
    };
    const days: LadderDay[] = (d.item ?? []).map((day) => ({
      date: day.date,
      boards: mapBoards(day.boards as Record<string, unknown[]> | undefined),
    }));
    return {
      timestamp: d.timestamp,
      window: {
        length: d.window?.length ?? days.length,
        dateList: d.window?.date_list ?? days.map((x) => x.date),
        boardCaps: (d.window?.board_caps ?? {}) as LimitUpLadder['window']['boardCaps'],
      },
      days,
    };
  }

  async getAnomalyList(tagCodes?: string[]): Promise<AnomalyStock[]> {
    const res = await this.guard(
      this.get().specialData.anomalyAnalysisList({ tagCodes: tagCodes?.join(',') }),
      '同花顺异动榜失败',
    );
    return (res.data?.item ?? []).map((d) => ({
      symbol: fromThsCode(d.thscode),
      stockName: d.stock_name ?? '',
      analysisContent: d.analysis_content ?? '',
      keywordList: d.keyword_list ?? [],
      tagName: d.tag_name ?? '',
    }));
  }

  async getAnomalyByStocks(symbols: Symbol[]): Promise<AnomalyStock[]> {
    const res = await this.guard(
      this.get().specialData.anomalyAnalysisStock({ thscodes: symbols.map(toThsCode).join(',') }),
      '同花顺个股异动失败',
    );
    return (res.data?.item ?? []).map((d) => ({
      symbol: fromThsCode(d.thscode),
      stockName: d.stock_name ?? '',
      analysisContent: d.analysis_content ?? '',
      keywordList: d.keyword_list ?? [],
      tagName: d.tag_name ?? '',
    }));
  }

  async getSkyrocketList(period?: 'day' | 'hour'): Promise<HotStock[]> {
    const res = await this.guard(
      this.get().specialData.skyrocketList({ period }),
      '同花顺飙升榜失败',
    );
    return (res.data?.item ?? []).map((d) => ({
      symbol: fromThsCode(d.thscode),
      name: d.name,
      rank: d.rank,
      heat: Number(d.heat) || 0,
      rankChange: d.rank_change ?? 0,
      rankTrend: d.rank_trend ?? '',
    }));
  }

  async getHotStockList(period?: 'day' | 'hour'): Promise<HotStock[]> {
    const res = await this.guard(
      this.get().specialData.hotStockList({ period }),
      '同花顺人气榜失败',
    );
    return (res.data?.item ?? []).map((d) => ({
      symbol: fromThsCode(d.thscode),
      name: d.name,
      rank: d.rank,
      heat: Number(d.heat) || 0,
      rankChange: d.rank_change ?? 0,
      rankTrend: d.rank_trend ?? '',
    }));
  }

  async getHotStockListHistory(date: string): Promise<HotStock[]> {
    const res = await this.guard(
      this.get().specialData.hotStockListHistory({ date }),
      '同花顺人气榜历史失败',
    );
    return (res.data?.item ?? []).map((d) => ({
      symbol: fromThsCode(d.thscode),
      name: d.name,
      rank: d.rank,
      heat: 0,
      rankChange: 0,
      rankTrend: 'unknown',
    }));
  }

  async getHotStockRankTrend(symbol: Symbol, startDate: string, endDate: string): Promise<HotStock[]> {
    const res = await this.guard(
      this.get().specialData.hotStockRankTrend({ thscode: toThsCode(symbol), startDate, endDate }),
      '同花顺人气趋势失败',
    );
    return (res.data?.item ?? []).map((d) => ({
      symbol,
      name: '',
      rank: d.rank,
      heat: 0,
      rankChange: 0,
      rankTrend: 'unknown',
    }));
  }

  async getDragonTigerList(opts?: { boardType?: string; date?: string }): Promise<DragonTigerList> {
    const res = await this.guard(
      this.get().specialData.dragonTigerList({
        boardType: opts?.boardType as 'all' | 'org' | 'hot_money',
        date: opts?.date,
      }),
      '同花顺龙虎榜失败',
    );
    const d = res.data;
    const stocks: DragonTigerStock[] = (d?.stock_items ?? []).map((s) => ({
      symbol: fromThsCode(s.thscode),
      name: s.name,
      conceptList: (s.concept_list ?? []).map((c) => c.name),
      change: s.change,
      buyValue: s.buy_value,
      sellValue: s.sell_value,
      netValue: s.net_value,
      netRate: s.net_rate,
      orgNetValue: s.org_net_value ?? 0,
      hotMoneyNetValue: s.hot_money_net_value ?? 0,
      hotRank: s.hot_rank,
      rangeDays: s.range_days,
      limitReason: s.limit_reason ?? '',
    }));
    const hotMoney: DragonTigerHotMoney[] = (d?.hot_money_items ?? []).map((h) => ({
      name: h.name,
      buying: h.buying,
      rows: (h.rows ?? []).map((s) => ({
        symbol: fromThsCode(s.thscode),
        name: s.name,
        conceptList: (s.concept_list ?? []).map((c) => c.name),
        change: s.change,
        amount: s.amount ?? 0,
        buyValue: s.buy_value,
        sellValue: s.sell_value,
        netValue: s.net_value,
        netRate: s.net_rate,
        orgNetValue: s.org_net_value ?? 0,
        hotMoneyNetValue: s.hot_money_net_value ?? 0,
        hotMoneyNetRate: s.hot_money_net_rate ?? 0,
        hotMoneyItemNetValue: s.hot_money_item_net_value ?? 0,
        hotMoneyItemNetRate: s.hot_money_item_net_rate ?? 0,
        hotRank: s.hot_rank,
        rangeDays: s.range_days,
      })),
    }));
    return {
      boardType: d?.board_type ?? opts?.boardType ?? 'all',
      tradeDate: d?.trade_date ?? opts?.date ?? '',
      count: d?.count ?? stocks.length,
      stockCount: d?.stock_count ?? stocks.length,
      stockItems: stocks,
      hotMoneyItems: hotMoney,
    };
  }

  // ===================== 交易日历 =====================
  async getTradingDays(): Promise<TradingDay[]> {
    const res = await this.guard(this.get().aShare.calendar.tradingDays(), '同花顺交易日历失败');
    return (res.data?.item ?? []).map((d) => ({
      dateMs: d.date_ms,
      date: d.date.length === 8 ? `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}` : d.date,
    }));
  }
}

/** 自注册到数据源注册表（内置主源，不可被禁） */
register(FUYAO_SOURCE_ID, FUYAO_SOURCE_NAME, () => new FuyaoApiSource(), true);

/** 兼容类型：FinancialStatementParams.period 需要 'annual' | 'quarterly' */
type FinancialStatementPeriod = 'annual' | 'quarterly';
