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

import { DataSourceError, type MarketDataSource } from '../MarketDataSource';
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
  FinancialIndicator,
  HistoricalFinancialParams,
  IndicatorsParams,
} from '../types';
import { HithsaHttpClient } from './HithsaHttpClient';
import { toThsCode, fromThsCode, marketOf } from '@/domain/symbol';
import { register } from '../DataSourceRegistry';

export const SOURCE_ID = 'hithsa';
export const SOURCE_NAME = '同花顺(iFinD)';

/**
 * 主源已稳定的 K 线周期。严格遵循 hithink-finance skill 契约
 * （references/api/endpoints-prices.md）：个股历史 K 线当前「仅支持 1d（日线）」，
 * 周K / 月K / 分钟K 均不在官方覆盖范围内，须由 MarketDataClient 路由到兜底源。
 */
const SUPPORTED_PERIODS = new Set(['day']);

/** 本源不支持的能力统一抛错，便于上层判断路由 */
function unsupported(method: string): never {
  throw new DataSourceError(`hithsa 不支持 ${method}`, SOURCE_ID, 3004);
}

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

export class HithsaApiSource implements MarketDataSource {
  readonly id = SOURCE_ID;
  readonly label = SOURCE_NAME;

  private static _instance: HithsaApiSource | null = null;
  static getInstance(): HithsaApiSource {
    if (!this._instance) this._instance = new HithsaApiSource(new HithsaHttpClient());
    return this._instance;
  }

  constructor(private readonly client: HithsaHttpClient = new HithsaHttpClient()) {}

  async init(): Promise<void> {}
  async dispose(): Promise<void> {}

  private guard<T>(p: Promise<T>, msg: string): Promise<T> {
    return p.catch((e: unknown) => {
      if (e instanceof DataSourceError) throw e;
      throw new DataSourceError(msg, SOURCE_ID, undefined, e);
    });
  }

  private toQuote(symbol: Symbol, d: any): Quote {
    const last = num(d.price) ?? 0;
    const prevClose = num(d.prev_close) ?? 0;
    const change = last - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;
    const high = num(d.high) ?? 0;
    const low = num(d.low) ?? 0;
    const open = num(d.open) ?? 0;
    const amplitudePct = prevClose ? ((high - low) / prevClose) * 100 : 0;
    return {
      symbol,
      last,
      prevClose,
      open,
      high,
      low,
      volume: num(d.volume) ?? 0,
      amount: num(d.amount) ?? 0,
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
    return Promise.all(
      symbols.map((s) =>
        this.guard(
          this.client
            .get('/api/stock/snapshot', { symbol: toThsCode(s), fields: 'basic' })
            .then((d: any) => this.toQuote(s, d)),
          `同花顺行情快照失败:${s.code}`,
        ),
      ),
    );
  }

  async getOrderBook(_symbol: Symbol): Promise<OrderBook> {
    // Skill 端点契约未定义 A 股五档盘口端点；保持禁用，由 MarketDataClient 路由到 stock-sdk。
    return unsupported('getOrderBook');
  }

  async getKline(params: KlineParams): Promise<Candle[]> {
    if (!SUPPORTED_PERIODS.has(params.period)) {
      // 周K / 月K / 分钟K 不在官方覆盖范围内，统一抛 3004 交由 MarketDataClient 路由到兜底源
      return unsupported(`getKline(${params.period})`);
    }
    const interval = '1d'; // skill 契约：个股历史 K 线当前仅支持 1d
    const adjust = params.adjust && params.adjust !== 'none' ? params.adjust : 'qfq';
    const endMs = params.endMs ?? Date.now();
    const data = await this.guard(
      this.client.get<any>('/api/stock/history', {
        symbol: toThsCode(params.symbol),
        interval,
        adjust,
        end_date: ymd(endMs),
        limit: String(params.count ?? 240),
      }),
      '同花顺个股K线失败',
    );
    if (!Array.isArray(data) || data.length === 0) {
      // 空结果视为「本源拿不到该数据」，抛 3004 继续尝试备源而非静默返回空
      throw new DataSourceError('同花顺个股K线返回为空', SOURCE_ID, 3004);
    }
    return data.map((d: any) => ({
      datetime: toMs(d.date),
      open: num(d.open) ?? 0,
      high: num(d.high) ?? 0,
      low: num(d.low) ?? 0,
      close: num(d.close) ?? 0,
      volume: num(d.volume) ?? 0,
      amount: num(d.amount) ?? undefined,
    }));
  }

  async getIndexKline(params: KlineParams): Promise<Candle[]> {
    if (!SUPPORTED_PERIODS.has(params.period)) {
      // 周K / 月K / 分钟K 不在官方覆盖范围内，统一抛 3004 交由 MarketDataClient 路由到兜底源
      return unsupported(`getIndexKline(${params.period})`);
    }
    const interval = '1d'; // skill 契约：指数历史 K 线当前仅支持 1d
    // 指数无复权语义：不要传 adjust（与 endpoints-index 契约一致）
    const endMs = params.endMs ?? Date.now();
    const data = await this.guard(
      this.client.get<any>('/api/index/history', {
        symbol: toThsCode(params.symbol),
        interval,
        end_date: ymd(endMs),
        limit: String(params.count ?? 240),
      }),
      '同花顺指数K线失败',
    );
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => ({
      datetime: toMs(d.date),
      open: num(d.open) ?? 0,
      high: num(d.high) ?? 0,
      low: num(d.low) ?? 0,
      close: num(d.close) ?? 0,
      volume: num(d.volume) ?? 0,
      amount: num(d.amount) ?? undefined,
    }));
  }

  async getIndexQuotes(symbols: Symbol[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];
    return Promise.all(
      symbols.map((s) =>
        this.guard(
          this.client
            .get('/api/index/snapshot', { symbol: toThsCode(s) })
            .then((d: any) => this.toQuote(s, d)),
          `同花顺指数行情失败:${s.code}`,
        ),
      ),
    );
  }

  // ------------------------- 复权因子 -------------------------
  async getAdjustmentFactors(symbol: Symbol, from?: string, to?: string): Promise<AdjustmentFactor[]> {
    const params: Record<string, string> = { symbol: toThsCode(symbol) };
    if (from != null) params.from_date = from;
    if (to != null) params.to_date = to;
    const data = await this.guard(
      this.client.get<any>('/api/stock/adjustment-factors', params),
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
            .get(`/api/stock/${toThsCode(s)}/valuations`, {})
            .then((data: any) =>
              (Array.isArray(data) ? data : [data]).map((d: any) => ({
                symbol: s,
                name: d.name,
                peTtm: num(d.pe_ttm),
                peMrq: num(d.pe_mrq),
                pbMrq: num(d.pb_mrq),
                psTtm: num(d.ps_ttm),
                pcfTtm: num(d.pcf_ttm),
                timestamp: num(d.timestamp) ?? Date.now(),
              })),
            ),
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
      periodEndMs: toMs(d.period_end ?? d.end_date),
      reportDateMs: toMs(d.report_date),
      fiscalYear: num(d.fiscal_year) ?? new Date(toMs(d.report_date)).getFullYear(),
      fiscalPeriod: d.fiscal_period ?? '',
      currency: d.currency ?? 'CNY',
    };
  }

  async getIncomeStatements(params: HistoricalFinancialParams): Promise<IncomeStatement[]> {
    const data = await this.guard(
      this.client.get<any>(`/api/stock/${toThsCode(params.symbol)}/finance/income`, {
        report_type: this.periodToType(params.period),
        count: String(params.limit ?? 4),
      }),
      '同花顺利润表失败',
    );
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => ({
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
      this.client.get<any>(`/api/stock/${toThsCode(params.symbol)}/finance/balance`, {
        report_type: this.periodToType(params.period),
        count: String(params.limit ?? 4),
      }),
      '同花顺资产负债表失败',
    );
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => ({
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
      this.client.get<any>(`/api/stock/${toThsCode(params.symbol)}/finance/cashflow`, {
        report_type: this.periodToType(params.period),
        count: String(params.limit ?? 4),
      }),
      '同花顺现金流量表失败',
    );
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => ({
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
      this.client.get<any>(`/api/stock/${toThsCode(params.symbol)}/finance/indicators`, {
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

  // ------------------------- 指数 -------------------------
  async listIndices(tag?: IndexTag): Promise<IndexInfo[]> {
    const params: Record<string, string> = {};
    if (tag) params.tag = tag;
    const data = await this.guard(this.client.get<any>('/api/index/list', params), '同花顺指数列表失败');
    const items = data?.item ?? data ?? [];
    if (!Array.isArray(items)) return [];
    return items.map((d: any) => ({
      symbol: fromThsCode(d.thscode ?? d.symbol),
      name: d.name,
    }));
  }

  async getIndexConstituents(symbol: Symbol): Promise<IndexConstituent[]> {
    const data = await this.guard(
      this.client.get<any>(`/api/index/${toThsCode(symbol)}/constituents`, {}),
      '同花顺指数成分失败',
    );
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => ({
      symbol: fromThsCode(d.thscode ?? d.symbol),
      name: d.name,
    }));
  }

  // ------------------------- 基金 -------------------------
  async getFundProfile(symbol: Symbol, _fundType: FundType): Promise<FundProfile> {
    const d = await this.guard(
      this.client.get<any>(`/api/fund/${toThsCode(symbol)}/profile`, {}),
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
      this.client.get<any>(`/api/fund/${toThsCode(symbol)}/holdings`, {}),
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
    const params: Record<string, string> = {};
    if (range) params.range = range;
    const data = await this.guard(
      this.client.get<any>(`/api/fund/${toThsCode(symbol)}/nav`, params),
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
      this.client.get<any>(`/api/fund/${toThsCode(symbol)}/returns`, {}),
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

  async getFundHolders(symbol: Symbol, _fundType: FundType, mergeScope?: string): Promise<FundHolder[]> {
    const params: Record<string, string> = {};
    if (mergeScope) params.merge_scope = mergeScope;
    const data = await this.guard(
      this.client.get<any>(`/api/fund/${toThsCode(symbol)}/holders`, params),
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
      this.client.get<any>(`/api/fund/${toThsCode(symbol)}/snapshot`, {}),
      '同花顺基金行情失败',
    );
    return this.toQuote(symbol, d);
  }

  async getFundHistorical(symbol: Symbol, startMs: number, endMs: number): Promise<Candle[]> {
    const data = await this.guard(
      this.client.get<any>(`/api/fund/${toThsCode(symbol)}/history`, {
        from_date: ymd(startMs),
        to_date: ymd(endMs),
      }),
      '同花顺基金历史失败',
    );
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => ({
      datetime: toMs(d.date),
      open: num(d.open ?? 0) ?? 0,
      high: num(d.high ?? 0) ?? 0,
      low: num(d.low ?? 0) ?? 0,
      close: num(d.close ?? d.nav ?? 0) ?? 0,
      volume: num(d.volume ?? 0) ?? 0,
      amount: num(d.amount) ?? undefined,
    }));
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
    if (opts?.dateMs != null) params.date = ymd(opts.dateMs);
    if (opts?.page != null) params.page = String(opts.page);
    if (opts?.size != null) params.size = String(opts.size);
    if (opts?.sortField) params.sort_field = opts.sortField;
    if (opts?.sortDir) params.sort_dir = opts.sortDir;
    const data = await this.guard(
      this.client.get<any>('/api/special/limit-up/pool', params),
      '同花顺涨停池失败',
    );
    const items = Array.isArray(data) ? data : data?.items ?? [];
    return {
      items: items.map((d: any) => ({
        symbol: fromThsCode(d.thscode ?? d.symbol),
        name: d.name,
        isSt: Boolean(d.is_st),
        isNew: Boolean(d.is_new),
        lastPrice: num(d.price) ?? 0,
        changePct: num(d.change_pct) ?? 0,
        limitUpTime: d.limit_up_time ?? d.time ?? '',
        limitUpReason: d.reason ?? d.limit_up_reason ?? '',
        continueDayText: d.continue_day_text ?? '',
        continueDayCnt: num(d.board_days ?? d.continue_day_cnt) ?? 0,
        sealMoney: num(d.seal_money) ?? 0,
        maxSealMoney: num(d.max_seal_money) ?? 0,
      })),
    };
  }

  async getLimitUpLadder(): Promise<unknown> {
    const data = await this.guard(
      this.client.get<any>('/api/special/limit-up/ladder', {}),
      '同花顺连板梯队失败',
    );
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => ({
      boardDays: num(d.board_days) ?? 0,
      count: num(d.count) ?? 0,
      stocks: Array.isArray(d.stocks)
        ? d.stocks.map((s: any) => ({
            symbol: fromThsCode(s.thscode ?? s.symbol),
            name: s.name,
            lastPrice: num(s.price) ?? 0,
            changePct: num(s.change_pct) ?? 0,
            isSt: Boolean(s.is_st),
            isNew: Boolean(s.is_new),
            limitUpTime: s.limit_up_time ?? '',
            limitUpReason: s.reason ?? '',
            continueDayText: s.continue_day_text ?? '',
            continueDayCnt: num(s.board_days) ?? 0,
            sealMoney: num(s.seal_money) ?? 0,
            maxSealMoney: num(s.max_seal_money) ?? 0,
          }))
        : [],
    }));
  }

  async getAnomalyList(tagCodes?: string[]): Promise<AnomalyStock[]> {
    const params: Record<string, string> = {};
    if (tagCodes && tagCodes.length) params.tag_codes = tagCodes.join(',');
    const data = await this.guard(
      this.client.get<any>('/api/special/anomaly/list', params),
      '同花顺异动榜失败',
    );
    const items = Array.isArray(data) ? data : data?.items ?? [];
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
      this.client.get<any>('/api/special/anomaly/by-stocks', {
        symbols: symbols.map(toThsCode).join(','),
      }),
      '同花顺个股异动失败',
    );
    const items = Array.isArray(data) ? data : data?.items ?? [];
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
      this.client.get<any>('/api/special/skyrocket/list', params),
      '同花顺飙升榜失败',
    );
    const items = Array.isArray(data) ? data : data?.items ?? [];
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
      this.client.get<any>('/api/special/hot-stock/list', params),
      '同花顺人气榜失败',
    );
    const items = Array.isArray(data) ? data : data?.items ?? [];
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
      this.client.get<any>('/api/special/hot-stock/history', { date }),
      '同花顺人气榜历史失败',
    );
    const items = Array.isArray(data) ? data : data?.items ?? [];
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
      this.client.get<any>(`/api/special/hot-stock/rank-trend/${toThsCode(symbol)}`, {
        from_date: startDate,
        to_date: endDate,
      }),
      '同花顺人气趋势失败',
    );
    const items = Array.isArray(data) ? data : data?.items ?? [];
    return items.map((d: any) => ({
      symbol,
      name: d.name,
      rank: num(d.rank) ?? 0,
      heat: num(d.heat ?? d.subscription_count) ?? 0,
      rankChange: num(d.rank_change) ?? 0,
      rankTrend: d.rank_trend ?? '',
    }));
  }

  async getDragonTigerList(opts?: { boardType?: string; date?: string }): Promise<DragonTigerList> {
    const params: Record<string, string> = {};
    if (opts?.boardType) params.board_type = opts.boardType;
    if (opts?.date) params.date = opts.date;
    const data = await this.guard(
      this.client.get<any>('/api/special/dragon-tiger/list', params),
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
      boardType: d.board_type ?? opts?.boardType ?? 'STIB',
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
      this.client.get<any>('/api/calendar/trading-days', { year: String(new Date().getFullYear()), market: 'A' }),
      '同花顺交易日历失败',
    );
    const days = Array.isArray(data) ? data : data?.days ?? [];
    return days.map((d: any) => {
      const ts = typeof d === 'number' ? d : toMs(d.date ?? d);
      const dateStr = typeof d === 'string' ? d : new Date(ts).toISOString().slice(0, 10);
      return { dateMs: ts, date: dateStr };
    });
  }
}

// 自注册到数据源注册表（内置主源，不可被禁）
register(SOURCE_ID, SOURCE_NAME, () => HithsaApiSource.getInstance(), false);
