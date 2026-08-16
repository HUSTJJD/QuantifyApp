/**
 * HithsaApiSource —— 同花顺金融数据官方 REST 主源（hithsa）。
 *
 * 端点契约来源：.agents/skills/hithink-finance/references/api/*.md
 * 统一 API Key：所有接口复用同一把 Key（HITHINK_FINANCE_API_KEY），详见 HithsaHttpClient。
 *
 * 设计原则：
 *  - 严格实现 MarketDataSource 接口：方法签名、返回类型必须与接口一致。
 *  - 仅实现 Skill 已定义契约的端点；未定义契约的能力（如 A 股五档盘口）
 *    统一抛 DataSourceError(3004)，由 MarketDataClient 路由到 stock-sdk / stock-api 兜底。
 *  - 指数无复权语义：getIndexKline 不传 adjust（与 endpoints-index 契约一致）。
 *  - 字段命名：入参用 snake_case（同花顺 API 契约），App 对外用 types 中的 camelCase。
 */

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
  FundMergeScope,
  FundProfile,
  FundReturn,
  FundType,
  FinancialReport,
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
  LimitUpLadder,
  LimitUpStock,
  ListResult,
  OrderBook,
  ProfitForecast,
  Quote,
  SearchParams,
  Symbol,
  TradingDay,
  Valuation,
  IncomeStatement,
  BalanceSheet,
  CashFlowStatement,
  FinancialIndicator,
  HistoricalFinancialParams,
  IndicatorsParams,
} from '../types';
import { HithsaHttpClient } from './HithsaHttpClient';
import { toThsCode, fromThsCode, marketOf, parseSymbol } from '@/domain/symbol';
import { cleanCandles } from '../candleValidity';
import { register } from '../DataSourceRegistry';

export const SOURCE_ID = 'hithsa';
export const SOURCE_NAME = '同花顺(iFinD)';

/**
 * 主源稳定的 K 线周期。同花顺官方历史 K 线端点（endpoints-prices.md）仅原生支持 1d（日线），
 * 周K / 月K 不在官方覆盖范围内。为避免依赖脆弱的兜底源（stock-sdk cn 历史接口不稳定），
 * 这里把「日线」作为唯一真实请求周期，并在主源内部把日线聚合为周/月 K 线后返回，
 * 从而让主源也能稳定提供 week / month。
 */
const SUPPORTED_PERIODS = new Set<KlinePeriod>(['day', 'week', 'month']);

/** 本源不支持的能力统一抛错，便于上层判断路由 */
function unsupported(method: string): never {
  throw new DataSourceError(`hithsa 不支持 ${method}`, SOURCE_ID, 3004);
}

/**
 * 官方快照接口的响应体形状：item 包装对象或裸数组。
 * 用联合类型代替 any[]，让 Array.isArray 的 false 分支不会收窄成 never。
 */
type EnvelopeData = { item?: unknown; [k: string]: unknown } | any[];

/**
 * 把日线 K 线聚合为周/月 K 线。
 *  - week：按 ISO 周（周一为一周起点）分组；
 *  - month：按自然月分组。
 * 每根聚合 K 线的取值：open=组内首根 open，high=组内最高，low=组内最低，
 * close=组内末根 close，volume/amount=组内求和；datetime 取组内末根（周五/月末）的时间。
 * 入参与返回均按时间升序。
 */
export function resampleKline(daily: Candle[], target: 'week' | 'month'): Candle[] {
  if (daily.length === 0) return [];
  const groups = new Map<number, Candle[]>();
  for (const c of daily) {
    const ms = new Date(c.datetime).getTime();
    if (!Number.isFinite(ms)) continue;
    const d = new Date(ms);
    if (target === 'week') {
      const dayNum = (d.getDay() + 6) % 7; // 周一=0 … 周日=6
      d.setDate(d.getDate() - dayNum);
    } else {
      d.setDate(1);
    }
    d.setHours(0, 0, 0, 0);
    const key = d.getTime();
    const arr = groups.get(key);
    if (arr) arr.push(c);
    else groups.set(key, [c]);
  }
  const result: Candle[] = [];
  for (const arr of groups.values()) {
    let open = 0;
    let high = -Infinity;
    let low = Infinity;
    let close = 0;
    let volume = 0;
    let amount: number | undefined;
    let lastDt = 0;
    for (const c of arr) {
      open = open === 0 ? c.open : open;
      high = Math.max(high, c.high);
      low = Math.min(low, c.low);
      close = c.close;
      volume += c.volume ?? 0;
      if (c.amount != null) amount = (amount ?? 0) + c.amount;
      lastDt = Math.max(lastDt, new Date(c.datetime).getTime());
    }
    result.push({
      datetime: new Date(lastDt).toISOString(),
      open,
      high: high === -Infinity ? 0 : high,
      low: low === Infinity ? 0 : low,
      close,
      volume,
      amount,
    });
  }
  result.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
  return result;
}

/**
 * 同花顺历史 K 线端点的时间窗口硬限制：`end - start` 最多 10 年（超出返回 code=1003）。
 * 注意：服务端按「含首尾计日」判定，恰好 3650 天会被判超限；这里取 10 年减去 30 天缓冲，
 * 确保周/月 K 用大 count（如 500）拉取时窗口仍落在合法范围内。
 */
const MAX_HIST_SPAN_MS = 10 * 365 * 24 * 3600 * 1000 - 30 * 24 * 3600 * 1000;

/** 毫秒时间戳 -> YYYY-MM-DD（同花顺 end_date / date 参数格式） */
function ymd(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 同花顺返回的日期（YYYY-MM-DD 或毫秒时间戳）-> 毫秒时间戳 */
function toMs(raw: string | number): number {
  if (typeof raw === 'number') return raw;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

/** 字符串数字安全转 number，失败返回 null */
function num(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

/** 把 ths 返回的若干 ticker 型 item 映射为 Instrument */
function toInstrument(item: any): Instrument {
  const symbol = fromThsCode(item.thscode ?? item.ticker ?? item.symbol);
  return {
    symbol,
    name: item.name,
    market: marketOf(symbol.exchange),
  };
}

export class HithsaApiSource extends BaseMarketDataSource {
  readonly id = SOURCE_ID;
  readonly label = SOURCE_NAME;

  /** 本源覆盖的能力（同 fuyao 的沪深 A 股为主；参数级限制见 supports）——强类型：DataSourceMethod */
  readonly capabilities: ReadonlySet<DataSourceMethod> = new Set([
    'listTickers', 'search', 'getQuotes', 'getKline',
    'getValuations', 'getIncomeStatements', 'getBalanceSheets', 'getCashFlowStatements',
    'getFinancialIndicators', 'getFinancials',
    'getAdjustmentFactors', 'listIndices', 'getIndexConstituents', 'getIndexQuotes',
    'getIndexKline', 'getFundProfile', 'getFundHoldings', 'getFundNav', 'getFundReturns',
    'getFundHolders', 'getFundMarketSnapshot', 'getFundHistorical',
    'getLimitUpPool', 'getLimitUpLadder', 'getAnomalyList', 'getAnomalyByStocks',
    'getSkyrocketList', 'getHotStockList', 'getHotStockListHistory', 'getHotStockRankTrend',
    'getDragonTigerList', 'getTradingDays',
  ]);

  private static _instance: HithsaApiSource | null = null;
  static getInstance(): HithsaApiSource {
    if (!this._instance) this._instance = new HithsaApiSource(new HithsaHttpClient());
    return this._instance;
  }

  constructor(private readonly client: HithsaHttpClient = new HithsaHttpClient()) {
    super();
  }

  async init(): Promise<void> {}
  async dispose(): Promise<void> {}

  /**
   * 参数级能力规格（声明式数据表，由 capability.ts 通用引擎统一决策）：
   *  - 行情/估值/财务等仅支持沪深京 A 股（SH / SZ / BJ，单标 + 批量同域）
   *  - K 线仅支持 day / week / month（分钟K 交由 stock-sdk 兜底）
   *  - 指数端点代码体系另支持 .TI（同花顺板块指数，endpoints-index 契约）
   */
  protected readonly spec: CapabilitySpec = {
    klinePeriods: [...SUPPORTED_PERIODS],
    singleSymbolExchanges: ['SH', 'SZ', 'BJ'],
    batchExchanges: ['SH', 'SZ', 'BJ'],
    indexExchanges: ['SH', 'SZ', 'TI'],
  };

  private guard<T>(p: Promise<T>, msg: string): Promise<T> {
    return p.catch((e: unknown) => {
      if (e instanceof DataSourceError) throw e;
      throw new DataSourceError(msg, SOURCE_ID, undefined, e);
    });
  }

  /**
   * 把同花顺官方快照字段（endpoints-prices.md 的 PriceSnapshotItem）映射成统一 Quote。
   * 官方字段：last_price / prev_price / open_price / high_price / low_price /
   * volume / turnover / price_change / price_change_ratio_pct / timestamp。
   * 兼容老字段别名（price/prev_close/...）以便过渡。
   */
  private toQuote(symbol: Symbol, d: any): Quote {
    const last = num(d.last_price ?? d.price) ?? 0;
    const prevClose = num(d.prev_price ?? d.prev_close) ?? 0;
    const open = num(d.open_price ?? d.open) ?? 0;
    const high = num(d.high_price ?? d.high) ?? 0;
    const low = num(d.low_price ?? d.low) ?? 0;
    const volume = num(d.volume) ?? 0;
    const amount = num(d.turnover ?? d.amount) ?? 0;
    const change = num(d.price_change) ?? last - prevClose;
    const changePct = num(d.price_change_ratio_pct) ?? (prevClose ? (change / prevClose) * 100 : 0);
    const amplitudePct = prevClose ? ((high - low) / prevClose) * 100 : 0;
    return {
      symbol,
      last,
      prevClose,
      open,
      high,
      low,
      volume,
      amount,
      change,
      changePct,
      amplitudePct,
      updatedAt: num(d.timestamp) ?? Date.now(),
    };
  }

  // ------------------------- 元信息 -------------------------
  async search(params: SearchParams): Promise<Instrument[]> {
    const q = await this.guard(
      this.client.get<any>('/api/meta/tickers/search', {
        q: params.keyword,
        exchange: params.exchange,
        asset_type: params.assetType,
        limit: String(params.limit ?? 10),
      }),
      '同花顺标的检索失败',
    );
    const items = q?.item ?? q ?? [];
    return items.map(toInstrument);
  }

  async listTickers(): Promise<Instrument[]> {
    const q = await this.guard(
      this.client.get<any>('/api/meta/tickers/list', { exchange: 'SH,SZ', limit: '1000', offset: '0' }),
      '同花顺标的列表失败',
    );
    const items = q?.item ?? q ?? [];
    return items.map(toInstrument);
  }

  // ------------------------- 行情 -------------------------
  async getQuotes(symbols: Symbol[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];
    // 港股/美股等同花顺官方不支持：整体转 3004 不支持信号，交由兜底源（stock-sdk）处理；
    // 统一抛 3004 而非裸 Error，便于 MarketDataClient.runWithFallback 识别为「预期内兜底」，不刷 ERROR 日志。
    const supported: Symbol[] = [];
    const unsupportedCodes: string[] = [];
    for (const s of symbols) {
      try {
        toThsCode(s);
        supported.push(s);
      } catch {
        unsupportedCodes.push(s.code);
      }
    }
    if (supported.length === 0) {
      throw new DataSourceError(
        `hithsa 不支持: ${unsupportedCodes.join(',')}`,
        SOURCE_ID,
        3004,
      );
    }
    // 单个未知 thscode（如某 BJ 代码不被快照接口识别）不应拖垮整批；
    // 解析出未知代码后剔除重试，保证其余有效代码（如 600519.SH）仍能返回。
    return this._getQuotesBatch(supported);
  }

  private async _getQuotesBatch(symbols: Symbol[]): Promise<Quote[]> {
    // 官方端点：GET /api/a-share/prices/snapshot?thscodes=600519.SH,000001.SZ（批量、逗号分隔）
    const thsCodes = symbols.map((s) => toThsCode(s)).join(',');
    let data: EnvelopeData;
    try {
      // 显式 cast 为 EnvelopeData：若直接赋 any[]，CFA 会把变量收窄为 any[]，
      // 导致下方 Array.isArray 的 false 分支变成 never、.item 访问报错。
      data = (await this.guard(
        this.client.get<any[]>('/api/a-share/prices/snapshot', { thscodes: thsCodes }),
        `同花顺行情快照失败:${thsCodes}`,
      )) as EnvelopeData;
    } catch (e) {
      // 容错：批量中某个 thscode 未知时，剔除后重试一次（其余有效代码仍可返回）
      const msg = e instanceof DataSourceError ? e.message : e instanceof Error ? e.message : '';
      const m = msg.match(/Unknown thscode:\s*([^\s,]+)/i);
      if (m) {
        const bad = m[1];
        const rest = symbols.filter((s) => toThsCode(s) !== bad);
        if (rest.length > 0 && rest.length < symbols.length) {
          return this._getQuotesBatch(rest);
        }
      }
      throw e;
    }
    // 按 thscode 反查 Symbol，构造统一 Quote（官方快照不含中文名，由 symbol 自带）
    const byThs = new Map<string, Symbol>(symbols.map((s) => [toThsCode(s), s]));
    const items: any[] = Array.isArray(data) ? data : ((data?.item ?? []) as any[]);
    const quotes: Quote[] = [];
    for (const d of items) {
      const s = byThs.get(d.thscode ?? d.ticker) ?? byThs.get(`${d.ticker}.SH`) ?? byThs.get(`${d.ticker}.SZ`);
      if (s) quotes.push(this.toQuote(s, d));
    }
    return quotes;
  }

  async getOrderBook(_symbol: Symbol): Promise<OrderBook> {
    // Skill 端点契约未定义 A 股五档盘口端点；保持禁用，由 MarketDataClient 路由到 stock-sdk。
    return unsupported('getOrderBook');
  }

  /** 拉取个股日线（同花顺官方端点仅支持 1d）并归一成 Candle[]；空结果抛 3004。 */
  private async fetchDailyKline(params: KlineParams, adjust: string | undefined): Promise<Candle[]> {
    const interval = '1d';
    const endMs = params.endMs ?? Date.now();
    // 周/月：为聚合预留足够多的日线（约 count*7 / count*31 天）
    const dailyCount = params.period === 'day'
      ? (params.count ?? 240)
      : Math.max(params.count ?? 240, 1) * (params.period === 'week' ? 7 : 31);
    let startMs = params.startMs ?? endMs - dailyCount * 24 * 3600 * 1000;
    // 周/月大 count 会让 startMs 早于 10 年前，超出端点硬限制（code=1003）——钳制到 10 年内
    startMs = Math.max(startMs, endMs - MAX_HIST_SPAN_MS);
    const data = await this.guard(
      this.client.get<any>('/api/a-share/prices/historical', {
        thscode: toThsCode(params.symbol),
        interval,
        start: startMs,
        end: endMs,
        adjust: adjust ?? 'forward',
      }),
      '同花顺个股K线失败',
    );
    const items = data?.item ?? data ?? [];
    if (!Array.isArray(items) || items.length === 0) {
      throw new DataSourceError('同花顺个股K线返回为空', SOURCE_ID, 3004);
    }
    const candles = cleanCandles(
      items.map((d: any) => ({
        datetime: toMs(d.date_ms),
        open: num(d.open_price) ?? 0,
        high: num(d.high_price) ?? 0,
        low: num(d.low_price) ?? 0,
        close: num(d.close_price) ?? 0,
        volume: num(d.volume) ?? 0,
        amount: num(d.turnover) ?? undefined,
      })),
    );
    if (candles.length === 0) {
      throw new DataSourceError('同花顺个股K线清洗后无有效数据', SOURCE_ID, 3004);
    }
    return candles;
  }

  async getKline(params: KlineParams): Promise<Candle[]> {
    if (!SUPPORTED_PERIODS.has(params.period)) {
      // 分钟K 不在官方覆盖范围内，统一抛 3004 交由 MarketDataClient 路由到兜底源
      return unsupported(`getKline(${params.period})`);
    }
    // 同花顺官方（hithsa）历史 K 线 adjust 直接沿用 AdjustMode 语义值：none / forward（前复权，默认）/ backward（后复权）。
    // 注意：stock-sdk 后端用 qfq/hfq/''，但 hithsa 官方契约（endpoints-prices.md）用的是 forward/backward/none，二者不可混用。
    const daily = await this.fetchDailyKline(params, params.adjust);
    // 日线直接返回；周/月在主源内聚合，避免依赖脆弱的兜底源。
    // 方法入口已用 SUPPORTED_PERIODS 守卫，此处周期必为 week / month。
    if (params.period === 'day') return daily;
    const agg = resampleKline(daily, params.period === 'week' ? 'week' : 'month');
    if (agg.length === 0) {
      throw new DataSourceError('同花顺个股K线聚合后无有效数据', SOURCE_ID, 3004);
    }
    return agg;
  }

  async getIndexKline(params: KlineParams): Promise<Candle[]> {
    if (!SUPPORTED_PERIODS.has(params.period)) {
      // 分钟K 不在官方覆盖范围内，统一抛 3004 交由 MarketDataClient 路由到兜底源
      return unsupported(`getIndexKline(${params.period})`);
    }
    const interval = '1d'; // skill 契约：指数历史 K 线当前仅支持 1d
    // 指数无复权语义：不要传 adjust（与 endpoints-index 契约一致）
    const endMs = params.endMs ?? Date.now();
    const dailyCount = params.period === 'day'
      ? (params.count ?? 240)
      : Math.max(params.count ?? 240, 1) * (params.period === 'week' ? 7 : 31);
    let startMs = params.startMs ?? endMs - dailyCount * 24 * 3600 * 1000;
    // 同上：钳制到 10 年窗口内，避免超限 code=1003
    startMs = Math.max(startMs, endMs - MAX_HIST_SPAN_MS);
    const data = await this.guard(
      this.client.get<any>('/api/a-share-index/prices/historical', {
        thscode: toThsCode(params.symbol),
        interval,
        start: startMs,
        end: endMs,
      }),
      '同花顺指数K线失败',
    ).catch((e: unknown) => {
      // 同花顺板块指数（.TI）历史 K 线端点当前不覆盖 → 按「无该周期数据」降级返回空，
      // 避免能力外标的反复触发真实故障把整源熔断（其余标的历史 K 失败仍如实上报）。
      if (params.symbol.exchange === 'TI') return [];
      throw e;
    });
    const items = data?.item ?? data ?? [];
    if (!Array.isArray(items)) return [];
    const candles = cleanCandles(
      items.map((d: any) => ({
        datetime: toMs(d.date_ms),
        open: num(d.open_price) ?? 0,
        high: num(d.high_price) ?? 0,
        low: num(d.low_price) ?? 0,
        close: num(d.close_price) ?? 0,
        volume: num(d.volume) ?? 0,
        amount: num(d.turnover) ?? undefined,
      })),
    );
    // 指数 K 线为空不抛错（指数历史可能短），直接返回已清洗结果
    // 方法入口已用 SUPPORTED_PERIODS 守卫，此处周期必为 week / month。
    if (params.period === 'day') return candles;
    // 周/月：在主源内由日线聚合，避免依赖脆弱的兜底源
    return resampleKline(candles, params.period === 'week' ? 'week' : 'month');
  }

  async getIndexQuotes(symbols: Symbol[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];
    const codes = symbols.map((s) => toThsCode(s)).join(',');
    // 官方端点：GET /api/a-share-index/prices/snapshot?thscodes=000001.SH,000300.SH（批量）
    const tiOnly = symbols.every((s) => s.exchange === 'TI');
    // 显式 cast 为 EnvelopeData：若直接赋 any[]，CFA 会把变量收窄为 any[]，
    // 导致下方 Array.isArray 的 false 分支变成 never、.item 访问报错。
    const data: EnvelopeData = (await this.guard(
      this.client.get<any[]>('/api/a-share-index/prices/snapshot', { thscodes: codes }),
      `同花顺指数快照失败:${codes}`,
    ).catch((e: unknown) => {
      // 同花顺板块指数（.TI）快照端点当前部分不覆盖 → 按「无行情」降级返回空，
      // 避免能力外标的反复触发真实故障把整源熔断（真实指数快照失败仍如实上报）。
      if (tiOnly) return [];
      throw e;
    })) as EnvelopeData;
    const byThs = new Map<string, Symbol>(symbols.map((s) => [toThsCode(s), s]));
    const items: any[] = Array.isArray(data) ? data : ((data?.item ?? []) as any[]);
    const quotes: Quote[] = [];
    for (const d of items) {
      const s = byThs.get(d.thscode ?? d.ticker);
      if (s) quotes.push(this.toQuote(s, d));
    }
    return quotes;
  }

  // ------------------------- 复权因子 -------------------------
  async getAdjustmentFactors(symbol: Symbol, from?: string, to?: string): Promise<AdjustmentFactor[]> {
    const params: Record<string, string> = { symbol: toThsCode(symbol) };
    if (from != null) params.from_date = from;
    if (to != null) params.to_date = to;
    const data = await this.guard(
      this.client.get<any>('/api/a-share/corporate-actions/adjustment-factors', params),
      '同花顺复权因子失败',
    );
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => ({
      symbol,
      ticker: fromThsCode(d.thscode ?? toThsCode(symbol)).code,
      exDateMs: toMs(d.date ?? d.ex_date),
      dividendPerShare: num(d.dividend_per_share ?? d.dividend) ?? 0,
      perShareBonus: num(d.per_share_bonus ?? d.bonus) ?? 0,
    }));
  }

  // ------------------------- 估值 -------------------------
  async getValuations(symbols: Symbol[]): Promise<Valuation[]> {
    if (symbols.length === 0) return [];
    const all = await Promise.all(
      symbols.map((s) =>
        this.guard(
          this.client
            .get(`/api/a-share/valuations/snapshot`, { thscodes: toThsCode(s) })
            .then((data: any) => {
              // 契约响应为 { timestamp, total, item[] }，数组嵌套在 item 下
              const items = data?.item ?? data ?? [];
              if (!Array.isArray(items)) return [];
              const ts = num(data?.timestamp) ?? Date.now();
              return items.map((d: any) => ({
                symbol: s,
                name: d.name,
                peTtm: num(d.pe_ttm),
                peMrq: num(d.pe_mrq),
                pbMrq: num(d.pb_mrq),
                psTtm: num(d.ps_ttm),
                pcfTtm: num(d.pcf_ttm),
                timestamp: ts,
              }));
            }),
          `同花顺估值失败:${s.code}`,
        ),
      ),
    );
    return all.flat();
  }

  // ------------------------- 财务报表 -------------------------
  private periodToType(period: string): 'annual' | 'quarterly' {
    return period === 'quarterly' ? 'quarterly' : 'annual';
  }

  private toFinancialCommon(symbol: Symbol, period: string, d: any) {
    return {
      symbol,
      period: (period === 'quarterly' ? 'quarterly' : 'annual') as 'annual' | 'quarterly',
      periodEndMs: toMs(d.period_end_ms ?? d.period_end ?? d.end_date),
      reportDateMs: toMs(d.report_date_ms ?? d.report_date),
      fiscalYear: num(d.fiscal_year) ?? new Date(toMs(d.report_date)).getFullYear(),
      fiscalPeriod: d.fiscal_period ?? '',
      currency: d.currency ?? 'CNY',
    };
  }

  async getIncomeStatements(params: HistoricalFinancialParams): Promise<IncomeStatement[]> {
    const data = await this.guard(
      this.client.get<any>(`/api/a-share/financials/income-statements`, {
        thscode: toThsCode(params.symbol),
        period: this.periodToType(params.period),
        limit: String(params.limit ?? 4),
      }),
      '同花顺利润表失败',
    );
    const items = data?.item ?? data ?? [];
    if (!Array.isArray(items)) return [];
    return items.map((d: any) => ({
      ...this.toFinancialCommon(params.symbol, params.period, d),
      basicEps: num(d.basic_eps),
      operatingIncome: num(d.operating_income ?? d.revenue),
      operatingCosts: num(d.operating_costs ?? d.op_cost),
      operatingExpenses: num(d.operating_expenses ?? d.op_expense),
      operatingProfit: num(d.operating_profit),
      profitTotal: num(d.profit_total),
      netProfit: num(d.net_profit),
      parentHolderNetProfit: num(d.parent_holder_net_profit),
      incomeTaxExpense: num(d.income_tax_expense),
      interestExpenses: num(d.interest_expenses),
      manageFee: num(d.manage_fee),
      salesFee: num(d.sales_fee),
      researchAndDevelopmentExpenses: num(d.research_and_development_expenses),
    }));
  }

  async getBalanceSheets(params: HistoricalFinancialParams): Promise<BalanceSheet[]> {
    const data = await this.guard(
      this.client.get<any>(`/api/a-share/financials/balance-sheets`, {
        thscode: toThsCode(params.symbol),
        period: this.periodToType(params.period),
        limit: String(params.limit ?? 4),
      }),
      '同花顺资产负债表失败',
    );
    const items = data?.item ?? data ?? [];
    if (!Array.isArray(items)) return [];
    return items.map((d: any) => ({
      ...this.toFinancialCommon(params.symbol, params.period, d),
      totalCurrentAssets: num(d.total_current_assets),
      nonCurrentNetsTotal: num(d.non_current_nets_total),
      assetsTotal: num(d.assets_total ?? d.total_assets),
      totalDebt: num(d.total_debt ?? d.total_liabilities),
      holderEquityTotal: num(d.holder_equity_total ?? d.equity),
      cash: num(d.cash),
      accountsReceivable: num(d.accounts_receivable),
    }));
  }

  async getCashFlowStatements(params: HistoricalFinancialParams): Promise<CashFlowStatement[]> {
    const data = await this.guard(
      this.client.get<any>(`/api/a-share/financials/cash-flow-statements`, {
        thscode: toThsCode(params.symbol),
        period: this.periodToType(params.period),
        limit: String(params.limit ?? 4),
      }),
      '同花顺现金流量表失败',
    );
    const items = data?.item ?? data ?? [];
    if (!Array.isArray(items)) return [];
    return items.map((d: any) => ({
      ...this.toFinancialCommon(params.symbol, params.period, d),
      actCashFlowNet: num(d.act_cash_flow_net ?? d.operating_cash_flow),
      investCashFlowNet: num(d.invest_cash_flow_net),
      financingCashFlowNet: num(d.financing_cash_flow_net),
      cashEquivalentsNetAddition: num(d.cash_equivalents_net_addition),
      payDividendsProfitsInterestCash: num(d.pay_dividends_profits_interest_cash),
      payFixedAssetsEtcCash: num(d.pay_fixed_assets_etc_cash),
    }));
  }

  async getFinancialIndicators(params: IndicatorsParams): Promise<FinancialIndicator[]> {
    const data = await this.guard(
      this.client.get<any>(`/api/a-share/financials/indicators`, {
        thscode: toThsCode(params.symbol),
        report: params.report,
      }),
      '同花顺财务指标失败',
    );
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => ({
      category: d.category ?? 'profitability',
      indexId: d.index_id ?? d.name ?? '',
      value: d.value != null ? String(d.value) : null,
    }));
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
    return unsupported('getProfitForecast');
  }

  // ------------------------- 指数 -------------------------
  async listIndices(tag?: IndexTag): Promise<IndexInfo[]> {
    const params: Record<string, string> = {};
    if (tag) params.tag = tag;
    const data = await this.guard(this.client.get<any>('/api/a-share-index/catalog/ths-index-list', params), '同花顺指数列表失败');
    const items = data?.item ?? data ?? [];
    if (!Array.isArray(items)) return [];
    return items.map((d: any) => {
      const symbol = fromThsCode(d.thscode ?? d.symbol);
      return { symbol: { ...symbol, name: d.name }, name: d.name };
    });
  }

  async getIndexConstituents(symbol: Symbol): Promise<IndexConstituent[]> {
    const data = await this.guard(
      this.client.get<any>(`/api/a-share-index/constituents/ths-stock-list`, { thscode: toThsCode(symbol) }),
      '同花顺指数成分失败',
    );
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => {
      const s = fromThsCode(d.thscode ?? d.symbol);
      return { symbol: { ...s, name: d.name }, name: d.name };
    });
  }

  // ------------------------- 基金 -------------------------
  async getFundProfile(symbol: Symbol, _fundType: FundType): Promise<FundProfile> {
    const d = await this.guard(
      this.client.get<any>('/api/fund/profile/detail', {
        fund_type: _fundType,
        thscode: toThsCode(symbol),
      }),
      '同花顺基金档案失败',
    );
    return {
      symbol,
      ticker: fromThsCode(d.thscode ?? toThsCode(symbol)).code,
      fundName: d.name ?? d.fund_name ?? null,
      estabDateMs: d.inception_date != null ? toMs(d.inception_date) : null,
      mgmtName: d.manager ?? d.mgmt_name ?? null,
      managerName: d.custodian ?? d.manager_name ?? null,
    };
  }

  async getFundHoldings(symbol: Symbol, _fundType: FundType): Promise<FundHolding[]> {
    const data = await this.guard(
      this.client.get<any>('/api/fund/portfolio/holdings', {
        fund_type: _fundType,
        thscode: toThsCode(symbol),
      }),
      '同花顺基金持仓失败',
    );
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => ({
      symbol: fromThsCode(d.thscode ?? d.symbol),
      ticker: fromThsCode(d.thscode ?? d.symbol).code,
      stockName: d.name ?? d.stock_name ?? '',
      holdRatio: num(d.weight) ?? 0,
    }));
  }

  async getFundNav(symbol: Symbol, _fundType: FundType, range?: string): Promise<FundNav[]> {
    const params: Record<string, string> = { fund_type: _fundType, thscode: toThsCode(symbol) };
    if (range) params.range = range;
    const data = await this.guard(
      this.client.get<any>('/api/fund/performance/nav', params),
      '同花顺基金净值失败',
    );
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => ({
      symbol,
      navDate: typeof d.date === 'string' ? d.date : ymd(toMs(d.date)),
      unitNav: num(d.nav),
      adjNav: num(d.accum_nav),
    }));
  }

  async getFundReturns(symbol: Symbol, _fundType: FundType): Promise<FundReturn> {
    const data = await this.guard(
      this.client.get<any>('/api/fund/performance/returns', {
        fund_type: _fundType,
        thscode: toThsCode(symbol),
      }),
      '同花顺基金回报失败',
    );
    const d = Array.isArray(data) ? data[0] ?? {} : data ?? {};
    const r = (k: string) => num(d[k]);
    return {
      symbol,
      returnMonth: r('return_month'),
      returnTmonth: r('return_tmonth'),
      returnHyar: r('return_hyar'),
      returnYear: r('return_year'),
      returnTyear: r('return_tyear'),
      returnFyear: r('return_fyear'),
      returnNowYear: r('return_now_year'),
      returnNow: r('return_now'),
    };
  }

  async getFundHolders(symbol: Symbol, _fundType: FundType, mergeScope?: FundMergeScope): Promise<FundHolder[]> {
    const params: Record<string, string> = { fund_type: _fundType, thscode: toThsCode(symbol) };
    if (mergeScope) params.merge_scope = mergeScope;
    const data = await this.guard(
      this.client.get<any>('/api/fund/holders/detail', params),
      '同花顺基金份额持有人失败',
    );
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => ({
      symbol,
      mergeScope: d.merge_scope === 'separate' ? 'separate' : 'merged',
      reportDateMs: toMs(d.report_date),
      insPosition: num(d.ins_position),
      holderAmount: num(d.holder_amount),
      avgHolderShare: num(d.avg_holder_share),
      psnlRate: num(d.psnl_rate),
      mgmtStaffHoldRate: num(d.mgmt_staff_hold_rate),
    }));
  }

  async getFundMarketSnapshot(symbol: Symbol): Promise<Quote> {
    const d = await this.guard(
      this.client.get<any>('/api/fund/market/snapshot', { thscode: toThsCode(symbol) }),
      '同花顺基金行情失败',
    );
    return this.toQuote(symbol, d);
  }

  async getFundHistorical(symbol: Symbol, startMs: number, endMs: number): Promise<Candle[]> {
    const data = await this.guard(
      this.client.get<any>('/api/fund/market/historical', {
        thscode: toThsCode(symbol),
        from_date: ymd(startMs),
        to_date: ymd(endMs),
      }),
      '同花顺基金历史失败',
    );
    if (!Array.isArray(data)) return [];
    return cleanCandles(
      data.map((d: any) => {
        // 基金历史净值通常只有 nav（收盘价），缺失的 open/high/low 回退到 close，
        // 否则会被 candleValidity 的「价格必须为正」规则全量剔除（映射成 0 也不通过）。
        const c = num(d.close ?? d.nav ?? 0) ?? 0;
        return {
          datetime: toMs(d.date),
          open: num(d.open ?? d.nav ?? c) ?? c,
          high: num(d.high ?? d.nav ?? c) ?? c,
          low: num(d.low ?? d.nav ?? c) ?? c,
          close: c,
          volume: num(d.volume ?? 0) ?? 0,
          amount: num(d.amount) ?? undefined,
        };
      }),
    );
  }

  // ------------------------- 特色数据 -------------------------
  async getLimitUpPool(opts?: {
    dateMs?: number;
    page?: number;
    size?: number;
    sortField?: string;
    sortDir?: string;
  }): Promise<ListResult<LimitUpStock>> {
    const params: Record<string, string> = {};
    if (opts?.dateMs != null) params.date_ms = String(opts.dateMs);
    if (opts?.page != null) params.page = String(opts.page);
    if (opts?.size != null) params.size = String(opts.size);
    if (opts?.sortField) params.sort_field = opts.sortField;
    if (opts?.sortDir) params.sort_dir = opts.sortDir;
    const data = await this.guard(
      this.client.get<any>('/api/a-share/special-data/limit-up-pool', params),
      '同花顺涨停池失败',
    );
    const items = Array.isArray(data) ? data : data?.item ?? [];
    return {
      items: items.map((d: any) => ({
        symbol: fromThsCode(d.thscode ?? d.symbol),
        name: d.name,
        isSt: Boolean(d.is_st),
        isNew: Boolean(d.is_new),
        lastPrice: num(d.last_price ?? d.price) ?? 0,
        changePct: num(d.price_change_ratio_pct ?? d.change_pct) ?? 0,
        limitUpTime: d.limit_up_time ?? d.time ?? '',
        limitUpReason: d.limit_up_reason ?? d.reason ?? '',
        continueDayText: d.continue_day_text ?? '',
        continueDayCnt: num(d.continue_day_cnt ?? d.board_days) ?? 0,
        sealMoney: num(d.seal_money) ?? 0,
        maxSealMoney: num(d.max_seal_money) ?? 0,
      })),
    };
  }

  async getLimitUpLadder(): Promise<LimitUpLadder> {
    const data = await this.guard(
      this.client.get<any>('/api/a-share/special-data/limit-up-ladder', {}),
      '同花顺连板梯队失败',
    );
    // 上游为「日期 → 板位」矩阵（{timestamp, window, item[]}），与 Fuyao 同源结构一致
    if (!data) {
      return {
        timestamp: 0,
        window: { length: 0, dateList: [], boardCaps: {} },
        days: [],
      };
    }
    const mapStock = (s: any): LadderStock => ({
      symbol: fromThsCode(s?.thscode ?? s?.ticker ?? ''),
      name: s?.name ?? '',
      boardNum: Number(s?.board_num) || 0,
      sealNextDay: s?.seal_nextday ?? null,
      signLevel: Number(s?.sign_level) || 0,
    });
    const boardKeys: LadderBoardKey[] = ['two_board', 'three_board', 'four_board', 'five_board', 'six_board', 'seven_over'];
    const mapBoards = (boards: any): Record<LadderBoardKey, LadderStock[]> => {
      const out = {} as Record<LadderBoardKey, LadderStock[]>;
      for (const k of boardKeys) {
        const list = boards?.[k];
        out[k] = Array.isArray(list) ? list.map(mapStock) : [];
      }
      return out;
    };
    const days: LadderDay[] = (data.item ?? []).map((day: any) => ({
      date: String(day?.date ?? ''),
      boards: mapBoards(day?.boards),
    }));
    return {
      timestamp: Number(data.timestamp) || 0,
      window: {
        length: Number(data.window?.length) || days.length,
        dateList: data.window?.date_list ?? days.map((x) => x.date),
        boardCaps: data.window?.board_caps ?? {},
      },
      days,
    };
  }

  async getAnomalyList(tagCodes?: string[]): Promise<AnomalyStock[]> {
    const params: Record<string, string> = {};
    if (tagCodes && tagCodes.length) params.tag_codes = tagCodes.join(',');
    const data = await this.guard(
      this.client.get<any>('/api/a-share/special-data/anomaly-analysis-list', params),
      '同花顺异动榜失败',
    );
    const items = Array.isArray(data) ? data : data?.item ?? [];
    return items.map((d: any) => ({
      symbol: fromThsCode(d.thscode ?? d.symbol),
      stockName: d.name ?? d.stock_name ?? '',
      analysisContent: d.analysis_content ?? d.content ?? '',
      keywordList: Array.isArray(d.keyword_list ?? d.keywords) ? d.keyword_list ?? d.keywords : [],
      tagName: d.tag_name ?? '',
    }));
  }

  async getAnomalyByStocks(symbols: Symbol[]): Promise<AnomalyStock[]> {
    const data = await this.guard(
      this.client.get<any>('/api/a-share/special-data/anomaly-analysis-stock', {
        thscodes: symbols.map(toThsCode).join(','),
      }),
      '同花顺个股异动失败',
    );
    const items = Array.isArray(data) ? data : data?.item ?? [];
    return items.map((d: any) => ({
      symbol: fromThsCode(d.thscode ?? d.symbol),
      stockName: d.name ?? d.stock_name ?? '',
      analysisContent: d.analysis_content ?? d.content ?? '',
      keywordList: Array.isArray(d.keyword_list ?? d.keywords) ? d.keyword_list ?? d.keywords : [],
      tagName: d.tag_name ?? '',
    }));
  }

  async getSkyrocketList(period?: 'day' | 'hour'): Promise<HotStock[]> {
    const params: Record<string, string> = {};
    if (period) params.period = period;
    const data = await this.guard(
      this.client.get<any>('/api/a-share/special-data/skyrocket-list', params),
      '同花顺飙升榜失败',
    );
    const items = Array.isArray(data) ? data : data?.item ?? [];
    return items.map((d: any) => ({
      symbol: fromThsCode(d.thscode ?? d.symbol),
      name: d.name,
      rank: num(d.rank) ?? 0,
      heat: num(d.heat ?? d.subscription_count) ?? 0,
      rankChange: num(d.rank_change) ?? 0,
      rankTrend: d.rank_trend ?? '',
    }));
  }

  async getHotStockList(period?: 'day' | 'hour'): Promise<HotStock[]> {
    const params: Record<string, string> = {};
    if (period) params.period = period;
    const data = await this.guard(
      this.client.get<any>('/api/a-share/special-data/hot-stock-list', params),
      '同花顺人气榜失败',
    );
    const items = Array.isArray(data) ? data : data?.item ?? [];
    return items.map((d: any) => ({
      symbol: fromThsCode(d.thscode ?? d.symbol),
      name: d.name,
      rank: num(d.rank) ?? 0,
      heat: num(d.heat ?? d.subscription_count) ?? 0,
      rankChange: num(d.rank_change) ?? 0,
      rankTrend: d.rank_trend ?? '',
    }));
  }

  async getHotStockListHistory(date: string): Promise<HotStock[]> {
    const data = await this.guard(
      this.client.get<any>('/api/a-share/special-data/hot-stock-list-history', { date }),
      '同花顺人气榜历史失败',
    );
    const items = Array.isArray(data) ? data : data?.item ?? [];
    return items.map((d: any) => ({
      symbol: fromThsCode(d.thscode ?? d.symbol),
      name: d.name,
      rank: num(d.rank) ?? 0,
      heat: num(d.heat ?? d.subscription_count) ?? 0,
      rankChange: num(d.rank_change) ?? 0,
      rankTrend: d.rank_trend ?? '',
    }));
  }

  async getHotStockRankTrend(symbol: Symbol, startDate: string, endDate: string): Promise<HotStock[]> {
    const data = await this.guard(
      this.client.get<any>('/api/a-share/special-data/hot-stock-rank-trend', {
        thscode: toThsCode(symbol),
        start_date: startDate,
        end_date: endDate,
      }),
      '同花顺人气趋势失败',
    );
    const items = Array.isArray(data) ? data : data?.item ?? [];
    return items.map((d: any) => ({
      symbol,
      // 新契约仅含 thscode/date/rank，名称等字段由调用方按需补齐
      name: d.name ?? '',
      rank: num(d.rank) ?? 0,
      heat: num(d.heat) ?? 0,
      rankChange: num(d.rank_change) ?? 0,
      rankTrend: d.rank_trend ?? 'unknown',
    }));
  }

  async getDragonTigerList(opts?: { boardType?: string; date?: string }): Promise<DragonTigerList> {
    const params: Record<string, string> = {};
    if (opts?.boardType) params.board_type = opts.boardType;
    if (opts?.date) params.date = opts.date;
    const data = await this.guard(
      this.client.get<any>('/api/a-share/special-data/dragon-tiger-list', params),
      '同花顺龙虎榜失败',
    );
    const d = Array.isArray(data) ? { stock_items: data } : data ?? {};
    const stocks: DragonTigerStock[] = (d.stock_items ?? d.items ?? []).map((s: any) => ({
      symbol: fromThsCode(s.thscode ?? s.symbol),
      name: s.name,
      conceptList: Array.isArray(s.concept_list ?? s.concepts) ? s.concept_list ?? s.concepts : [],
      change: num(s.change) ?? 0,
      buyValue: num(s.buy_value ?? s.buy_amount) ?? 0,
      sellValue: num(s.sell_value ?? s.sell_amount) ?? 0,
      netValue: num(s.net_value ?? s.net_amount) ?? 0,
      netRate: num(s.net_rate) ?? 0,
      orgNetValue: num(s.org_net_value) ?? 0,
      hotMoneyNetValue: num(s.hot_money_net_value) ?? 0,
      hotRank: num(s.hot_rank) ?? 0,
      rangeDays: num(s.range_days) ?? 0,
      limitReason: s.limit_reason ?? s.reason ?? '',
    }));
    const hotMoney: DragonTigerHotMoney[] = (d.hot_money_items ?? []).map((h: any) => ({
      name: h.name,
      buying: num(h.buying ?? h.buy_value) ?? 0,
      rows: (h.rows ?? []).map((s: any) => ({
        symbol: fromThsCode(s.thscode ?? s.symbol),
        name: s.name,
        conceptList: Array.isArray(s.concept_list ?? s.concepts) ? s.concept_list ?? s.concepts : [],
        change: num(s.change) ?? 0,
        amount: num(s.amount) ?? 0,
        buyValue: num(s.buy_value) ?? 0,
        sellValue: num(s.sell_value) ?? 0,
        netValue: num(s.net_value) ?? 0,
        netRate: num(s.net_rate) ?? 0,
        orgNetValue: num(s.org_net_value) ?? 0,
        hotMoneyNetValue: num(s.hot_money_net_value) ?? 0,
        hotMoneyNetRate: num(s.hot_money_net_rate) ?? 0,
        hotMoneyItemNetValue: num(s.hot_money_item_net_value) ?? 0,
        hotMoneyItemNetRate: num(s.hot_money_item_net_rate) ?? 0,
        hotRank: num(s.hot_rank) ?? 0,
        rangeDays: num(s.range_days) ?? 0,
      })),
    }));
    return {
      boardType: d.board_type ?? opts?.boardType ?? 'all',
      tradeDate: d.trade_date ?? opts?.date ?? '',
      count: d.count ?? stocks.length,
      stockCount: d.stock_count ?? stocks.length,
      stockItems: stocks,
      hotMoneyItems: hotMoney,
    };
  }

  // ------------------------- 交易日历 -------------------------
  async getTradingDays(): Promise<TradingDay[]> {
    const data = await this.guard(
      this.client.get<any>('/api/a-share/calendar/trading-days'),
      '同花顺交易日历失败',
    );
    const days = Array.isArray(data) ? data : data?.item ?? [];
    return days.map((d: any) => {
      const ts = num(d.date_ms) ?? (typeof d === 'number' ? d : toMs(d.date ?? d));
      let dateStr = typeof d === 'string' ? d : d?.date ?? '';
      // 契约为 yyyyMMdd（如 20250701），统一转为 yyyy-mm-dd 供 App 内使用
      if (/^\d{8}$/.test(dateStr)) {
        dateStr = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
      }
      return { dateMs: ts, date: dateStr };
    });
  }
}

// 自注册到数据源注册表（内置主源，不可被禁）
register(SOURCE_ID, SOURCE_NAME, () => HithsaApiSource.getInstance(), false);
