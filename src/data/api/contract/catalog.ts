/**
 * contract/catalog.ts —— 88 个数据源方法的统一目录（冒烟夹具 + 结果契约）。
 *
 * 定位：methods.ts 定义「签名」，本文件定义「怎么用、怎么算对」，是唯一真相源的下游。
 * 三个消费者共用同一份目录，避免各写一套导致漂移：
 *  1. Jest 契约测试（__tests__/sourceContract.test.ts，mock 后端不联网）
 *  2. App 内单源自检（features/debug/SourceTestScreen，真实请求）
 *  3. 能力审计（contract/audit.ts，静态比对声明/实现/接口）
 *
 * 完整性由类型强制：CatalogMap 是 DataSourceMethod 的全量映射，
 * 少一个方法、或 key 与 method 不对应，都直接编译报错。
 */
import type { DataSourceMethod, MethodArgs, MethodResult } from '@/data/api';

/** 方法分组（比原 8 组多出扩展能力分组） */
export type MethodGroupKey =
  | 'meta'
  | 'quote'
  | 'valuation'
  | 'finance'
  | 'index'
  | 'fund'
  | 'features'
  | 'calendar'
  | 'holder'
  | 'news'
  | 'capital'
  | 'limit'
  | 'timeshare'
  | 'overseas'
  | 'fundExt'
  | 'derivatives'
  | 'northbound'
  | 'misc';

export const METHOD_GROUP_TITLES: Record<MethodGroupKey, string> = {
  meta: '元信息',
  quote: '行情',
  valuation: '估值',
  finance: '财务',
  index: '指数 / 板块',
  fund: '基金',
  features: '特色数据',
  calendar: '交易日历',
  holder: '股东 / 榜单',
  news: '资讯 / 公告',
  capital: '资金流',
  limit: '涨跌停 / 龙虎榜',
  timeshare: '分时',
  overseas: '港股 / 美股',
  fundExt: '基金扩展',
  derivatives: '期权 / 期货',
  northbound: '北向资金',
  misc: '其它',
};

export const METHOD_GROUP_ORDER: MethodGroupKey[] = [
  'meta',
  'quote',
  'timeshare',
  'overseas',
  'valuation',
  'finance',
  'holder',
  'news',
  'capital',
  'limit',
  'index',
  'features',
  'fund',
  'fundExt',
  'derivatives',
  'northbound',
  'calendar',
  'misc',
];

export type MethodCatalogEntry = {
  [M in DataSourceMethod]: {
    method: M;
    label: string;
    group: MethodGroupKey;
    /** 冒烟夹具：一次最小可用调用的参数（缺省 = 无通用夹具，只做能力/存在性检查） */
    buildArgs?: () => MethodArgs<M>;
    /**
     * 结果契约断言：返回 null 表示通过，返回字符串表示违反契约的原因。
     * 只校验「统一契约要求的字段」，不校验具体数值（数值由后端决定）。
     */
    assertResult?: (result: MethodResult<M>) => string | null;
  };
}[DataSourceMethod];

/** 全量映射：key 必须与 method 严格对应，缺项编译报错 */
type CatalogMap = { [M in DataSourceMethod]: Extract<MethodCatalogEntry, { method: M }> };

// ---------------- 夹具常量 ----------------

const A_SHARE = { code: '600519', exchange: 'SH' as const, name: '贵州茅台' };
const SH_IDX = { code: '000001', exchange: 'SH' as const, name: '上证指数' };
const INDEX_300 = { code: '000300', exchange: 'SH' as const, name: '沪深300' };
const OTC_FUND = { code: '161725', exchange: 'OF' as const, name: '招商中证白酒' };

const ymd = (offsetDays: number): string => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------------- 通用结果断言 ----------------

/** 数组结果：至少要求「是数组」（是否允许空由调用方决定） */
function isArray(msg = '结果不是数组'): (r: unknown) => string | null {
  return r => (Array.isArray(r) ? null : msg);
}

/** 数组非空 + 每行过 row 断言 */
function nonEmptyRows<T>(row: (x: T) => string | null, label: string): (r: T[]) => string | null {
  return r => {
    if (!Array.isArray(r)) return `${label}: 结果不是数组`;
    if (r.length === 0) return `${label}: 结果为空数组`;
    for (const x of r) {
      const err = row(x);
      if (err) return `${label}: ${err}`;
    }
    return null;
  };
}

const num = (v: unknown, field: string): string | null =>
  typeof v === 'number' && Number.isFinite(v) ? null : `${field} 不是有限数值`;

/** 可空有限数：undefined/null 合法，数字必须有限 */
const numOrNull = (v: unknown, field: string): string | null =>
  v == null || (typeof v === 'number' && Number.isFinite(v)) ? null : `${field} 不是 null 或有限数值`;

const nonEmptyStr = (v: unknown, field: string): string | null =>
  typeof v === 'string' && v.length > 0 ? null : `${field} 不是非空字符串`;

const hasSymbol = (v: unknown): string | null => {
  if (!v || typeof v !== 'object') return '缺少 symbol';
  const s = v as { code?: unknown; exchange?: unknown };
  return typeof s.code === 'string' && s.code.length > 0 && typeof s.exchange === 'string' && s.exchange.length > 0
    ? null
    : 'symbol.code/exchange 缺失或为空';
};

/** 行情语义：禁止全 0 快照（last/prevClose 双 0 = 上游无数据被伪造） */
const quoteSemantics = (q: { last?: number; prevClose?: number }): string | null => {
  if (typeof q.last !== 'number' || !Number.isFinite(q.last)) return 'last 不是有限数值';
  if (q.last === 0 && (!q.prevClose || q.prevClose === 0)) {
    return '行情 last/prevClose 全为 0，疑似上游无数据被伪造快照';
  }
  return null;
};

/** K 线语义：OHLC 有限且 high >= low；open/close 在 [low, high] 内（允许边界） */
function candleSemantics(c: {
  datetime?: unknown; open?: number; high?: number; low?: number; close?: number;
}): string | null {
  if (c.datetime == null) return 'datetime 缺失';
  const o = c.open, h = c.high, l = c.low, cl = c.close;
  if (typeof o !== 'number' || !Number.isFinite(o)) return 'open 不是有限数值';
  if (typeof h !== 'number' || !Number.isFinite(h)) return 'high 不是有限数值';
  if (typeof l !== 'number' || !Number.isFinite(l)) return 'low 不是有限数值';
  if (typeof cl !== 'number' || !Number.isFinite(cl)) return 'close 不是有限数值';
  if (h < l) return `high(${h}) < low(${l})`;
  if (o < l - 1e-9 || o > h + 1e-9) return `open(${o}) 不在 [low,high] 内`;
  if (cl < l - 1e-9 || cl > h + 1e-9) return `close(${cl}) 不在 [low,high] 内`;
  return null;
}

/** 统一 Quote 行语义 */
function quoteRow(q: unknown, label = '行情'): string | null {
  if (!q || typeof q !== 'object') return `${label}: 行不是对象`;
  const row = q as { symbol?: unknown; last?: number; prevClose?: number; open?: number; high?: number; low?: number; volume?: number };
  const e = hasSymbol(row.symbol);
  if (e) return `${label}: ${e}`;
  const s = quoteSemantics(row);
  if (s) return `${label}: ${s}`;
  if (row.volume != null && (typeof row.volume !== 'number' || !Number.isFinite(row.volume))) {
    return `${label}: volume 非法`;
  }
  return null;
}

// ---------------- 目录本体 ----------------

export const METHOD_CATALOG: CatalogMap = {
  // ================= 元信息 =================
  search: {
    method: 'search',
    label: '搜索',
    group: 'meta',
    buildArgs: () => [{ keyword: '贵州茅台' }],
    assertResult: nonEmptyRows<{ symbol?: unknown; name?: string; market?: string }>(r => {
      const e = hasSymbol(r?.symbol);
      if (e) return e;
      return nonEmptyStr(r?.name, 'name');
    }, '搜索'),
  },
  listTickers: {
    method: 'listTickers',
    label: '股票列表',
    group: 'meta',
    buildArgs: () => [{ limit: 3 }],
    assertResult: isArray('股票列表不是数组'),
  },

  // ================= 行情 =================
  getQuotes: {
    method: 'getQuotes',
    label: 'A股行情',
    group: 'quote',
    buildArgs: () => [[A_SHARE]],
    assertResult: nonEmptyRows<unknown>(q => quoteRow(q, '行情'), '行情'),
  },
  getOrderBook: {
    method: 'getOrderBook',
    label: 'A股盘口',
    group: 'quote',
    buildArgs: () => [A_SHARE],
    assertResult: r => {
      const ob = r as { bids?: unknown; asks?: unknown };
      if (!Array.isArray(ob?.bids) || !Array.isArray(ob?.asks)) return '盘口 bids/asks 不是数组';
      return null;
    },
  },
  getKline: {
    method: 'getKline',
    label: 'A股日K',
    group: 'quote',
    buildArgs: () => [{ symbol: A_SHARE, period: 'day', count: 30, adjust: 'none' }],
    assertResult: r => {
      if (!Array.isArray(r)) return 'K线不是数组';
      if (r.length === 0) return 'K线为空数组';
      for (const c of r as Array<Parameters<typeof candleSemantics>[0]>) {
        const err = candleSemantics(c);
        if (err) return `K线: ${err}`;
      }
      return null;
    },
  },
  getAdjustmentFactors: {
    method: 'getAdjustmentFactors',
    label: '复权因子',
    group: 'quote',
    buildArgs: () => [A_SHARE, '2024-01-01', '2024-06-30'],
    assertResult: isArray('复权因子不是数组'),
  },

  // ================= 估值 =================
  getValuations: {
    method: 'getValuations',
    label: '估值',
    group: 'valuation',
    buildArgs: () => [[A_SHARE]],
    assertResult: nonEmptyRows<{ symbol?: unknown; peTtm?: number | null; pbMrq?: number | null }>(v => {
      const e = hasSymbol(v?.symbol);
      if (e) return e;
      return numOrNull(v?.peTtm, 'peTtm') ?? numOrNull(v?.pbMrq, 'pbMrq');
    }, '估值'),
  },

  // ================= 财务 =================
  getIncomeStatements: {
    method: 'getIncomeStatements',
    label: '利润表',
    group: 'finance',
    buildArgs: () => [{ symbol: A_SHARE, period: 'annual' }],
    assertResult: isArray('利润表不是数组'),
  },
  getBalanceSheets: {
    method: 'getBalanceSheets',
    label: '资产负债表',
    group: 'finance',
    buildArgs: () => [{ symbol: A_SHARE, period: 'annual' }],
    assertResult: isArray('资产负债表不是数组'),
  },
  getCashFlowStatements: {
    method: 'getCashFlowStatements',
    label: '现金流量表',
    group: 'finance',
    buildArgs: () => [{ symbol: A_SHARE, period: 'annual' }],
    assertResult: isArray('现金流量表不是数组'),
  },
  getFinancialIndicators: {
    method: 'getFinancialIndicators',
    label: '财务指标',
    group: 'finance',
    buildArgs: () => [{ symbol: A_SHARE, report: '2024-4' }],
    assertResult: isArray('财务指标不是数组'),
  },
  getFinancials: {
    method: 'getFinancials',
    label: '财报摘要',
    group: 'finance',
    buildArgs: () => ['600519'],
    assertResult: isArray('财报摘要不是数组'),
  },
  getProfitForecast: {
    method: 'getProfitForecast',
    label: '业绩预测',
    group: 'finance',
    buildArgs: () => ['600519'],
    assertResult: isArray('业绩预测不是数组'),
  },

  // ================= 指数 / 板块 =================
  listIndices: {
    method: 'listIndices',
    label: '板块目录',
    group: 'index',
    buildArgs: () => ['industry'],
    assertResult: isArray('板块目录不是数组'),
  },
  getIndexConstituents: {
    method: 'getIndexConstituents',
    label: '指数成分',
    group: 'index',
    buildArgs: () => [INDEX_300],
    assertResult: isArray('指数成分不是数组'),
  },
  getIndexQuotes: {
    method: 'getIndexQuotes',
    label: '指数行情',
    group: 'index',
    buildArgs: () => [[SH_IDX]],
    assertResult: nonEmptyRows<unknown>(q => quoteRow(q, '指数行情'), '指数行情'),
  },
  getIndexKline: {
    method: 'getIndexKline',
    label: '指数日K',
    group: 'index',
    buildArgs: () => [{ symbol: SH_IDX, period: 'day', count: 30 }],
    assertResult: isArray('指数K线不是数组'),
  },

  // ================= 基金 =================
  getFundProfile: {
    method: 'getFundProfile',
    label: '基金档案',
    group: 'fund',
    buildArgs: () => [OTC_FUND, 'otc'],
    assertResult: r => {
      const p = r as { symbol?: unknown; ticker?: string };
      const e = hasSymbol(p?.symbol);
      if (e) return e;
      return nonEmptyStr(p?.ticker, 'ticker');
    },
  },
  getFundHoldings: {
    method: 'getFundHoldings',
    label: '基金持仓',
    group: 'fund',
    buildArgs: () => [OTC_FUND, 'otc'],
    assertResult: nonEmptyRows<{ symbol?: unknown; ticker?: string; stockName?: string; holdRatio?: number }>(h => {
      const e = hasSymbol(h?.symbol);
      if (e) return e;
      return nonEmptyStr(h?.ticker, 'ticker') ?? num(h?.holdRatio, 'holdRatio');
    }, '基金持仓'),
  },
  getFundNav: {
    method: 'getFundNav',
    label: '基金净值',
    group: 'fund',
    buildArgs: () => [OTC_FUND, 'otc', 'year'],
    assertResult: nonEmptyRows<{ symbol?: unknown; navDate?: string; unitNav?: number | null }>(n => {
      const e = hasSymbol(n?.symbol);
      if (e) return e;
      return nonEmptyStr(n?.navDate, 'navDate') ?? numOrNull(n?.unitNav, 'unitNav');
    }, '基金净值'),
  },
  getFundReturns: {
    method: 'getFundReturns',
    label: '区间收益',
    group: 'fund',
    buildArgs: () => [OTC_FUND, 'otc'],
  },
  getFundHolders: {
    method: 'getFundHolders',
    label: '基金持有人',
    group: 'fund',
    buildArgs: () => [OTC_FUND, 'otc'],
    assertResult: isArray('基金持有人不是数组'),
  },
  getFundMarketSnapshot: {
    method: 'getFundMarketSnapshot',
    label: '基金行情快照',
    group: 'fund',
    buildArgs: () => [OTC_FUND],
    assertResult: r => {
      const q = r as { symbol?: unknown; last?: number };
      return quoteRow(q, '基金快照');
    },
  },
  getFundHistorical: {
    method: 'getFundHistorical',
    label: '历史净值',
    group: 'fund',
    buildArgs: () => [OTC_FUND, Date.now() - 90 * 86_400_000, Date.now()],
    assertResult: isArray('历史净值不是数组'),
  },

  // ================= 特色数据 =================
  getLimitUpPool: {
    method: 'getLimitUpPool',
    label: '涨停池',
    group: 'features',
    buildArgs: () => [{}],
    assertResult: r => {
      const w = r as { items?: unknown };
      if (!w || !Array.isArray(w.items)) return '涨停池 items 不是数组';
      return nonEmptyRows<{ symbol?: unknown; name?: string; lastPrice?: number; changePct?: number }>(it => {
        const e = hasSymbol(it?.symbol);
        if (e) return e;
        return nonEmptyStr(it?.name, 'name') ?? num(it?.lastPrice, 'lastPrice');
      }, '涨停池')(w.items as never[]);
    },
  },
  getLimitUpLadder: {
    method: 'getLimitUpLadder',
    label: '涨停梯队',
    group: 'features',
    buildArgs: () => [],
    assertResult: r => {
      const l = r as { days?: unknown };
      if (!l || !Array.isArray(l.days)) return '天梯 days 不是数组';
      return null;
    },
  },
  getLimitDownPool: { method: 'getLimitDownPool', label: '跌停池', group: 'features', buildArgs: () => [{}] },
  getLimitBreakPool: { method: 'getLimitBreakPool', label: '炸板池', group: 'features', buildArgs: () => [{}] },
  getMarketFundFlow: {
    method: 'getMarketFundFlow',
    label: '大盘资金流',
    group: 'capital',
    buildArgs: () => [],
    assertResult: isArray('大盘资金流不是数组'),
  },
  getOptionEtfMonths: {
    method: 'getOptionEtfMonths',
    label: 'ETF期权月份',
    group: 'derivatives',
    buildArgs: () => ['50ETF' as const],
    assertResult: r => {
      const o = r as { months?: unknown };
      return Array.isArray(o?.months) ? null : 'months 不是数组';
    },
  },
  getOptionEtfExpireDay: {
    method: 'getOptionEtfExpireDay',
    label: 'ETF期权到期日',
    group: 'derivatives',
    buildArgs: () => ['50ETF' as const, '2024-09'],
    assertResult: r => {
      const o = r as { expireDay?: unknown };
      return typeof o?.expireDay === 'string' ? null : 'expireDay 缺失';
    },
  },
  getOptionEtfMinuteKline: {
    method: 'getOptionEtfMinuteKline',
    label: 'ETF期权分钟K',
    group: 'derivatives',
    buildArgs: () => ['10004336'],
    assertResult: isArray('ETF期权分钟K不是数组'),
  },
  getKlineWithIndicators: {
    method: 'getKlineWithIndicators',
    label: 'K线+指标',
    group: 'quote',
    buildArgs: () => [{ symbol: A_SHARE, period: 'daily' as const, indicators: { ma: [5, 10] } }],
    assertResult: isArray('指标K线不是数组'),
  },
  getKlineSignals: {
    method: 'getKlineSignals',
    label: 'K线信号',
    group: 'quote',
    buildArgs: () => [{ symbol: A_SHARE, period: 'daily' as const }],
    assertResult: isArray('K线信号不是数组'),
  },
  getStockChangeEvents: {
    method: 'getStockChangeEvents',
    label: '盘口异动事件',
    group: 'features',
    buildArgs: () => ['rocket_launch' as const],
    assertResult: isArray('盘口异动不是数组'),
  },
  getIndividualChangeEvents: {
    method: 'getIndividualChangeEvents',
    label: '个股异动事件',
    group: 'features',
    buildArgs: () => [{ symbol: A_SHARE }],
    assertResult: isArray('个股异动不是数组'),
  },
  getDragonTigerStockStats: {
    method: 'getDragonTigerStockStats',
    label: '龙虎榜统计',
    group: 'limit',
    buildArgs: () => ['1month' as const],
    assertResult: isArray('龙虎榜统计不是数组'),
  },
  getFundDividendList: {
    method: 'getFundDividendList',
    label: '基金分红列表',
    group: 'fundExt',
    buildArgs: () => [{ year: new Date().getFullYear(), page: 1 }],
    assertResult: isArray('基金分红不是数组'),
  },
  getFundRankHistory: {
    method: 'getFundRankHistory',
    label: '基金排名走势',
    group: 'fundExt',
    buildArgs: () => [OTC_FUND],
    assertResult: r => {
      const o = r as { items?: unknown };
      return Array.isArray(o?.items) ? null : 'items 不是数组';
    },
  },
  getLargeOrderRatios: {
    method: 'getLargeOrderRatios',
    label: '盘口大单占比',
    group: 'quote',
    buildArgs: () => [[A_SHARE]],
    assertResult: isArray('盘口大单不是数组'),
  },
  getAuctionSnapshot: {
    method: 'getAuctionSnapshot',
    label: '集合竞价',
    group: 'features',
    buildArgs: () => [{ symbols: [A_SHARE], stage: 'final' as const }],
    assertResult: isArray('集合竞价不是数组'),
  },
  getShortTermBenchmark: {
    method: 'getShortTermBenchmark',
    label: '短线风向标',
    group: 'features',
    buildArgs: () => [ymd(0)],
    assertResult: isArray('短线风向标不是数组'),
  },
  getMarketStatus: {
    method: 'getMarketStatus',
    label: '市场状态',
    group: 'calendar',
    buildArgs: () => ['A' as const],
    assertResult: r =>
      r === 'pre_market' || r === 'open' || r === 'lunch_break' || r === 'after_hours' || r === 'closed'
        ? null
        : '非法市场状态',
  },
  getAnomalyList: { method: 'getAnomalyList', label: '异动榜', group: 'features', buildArgs: () => [[]] },
  getAnomalyByStocks: {
    method: 'getAnomalyByStocks',
    label: '按股查异动',
    group: 'features',
    buildArgs: () => [[A_SHARE]],
    assertResult: isArray('异动不是数组'),
  },
  getSkyrocketList: { method: 'getSkyrocketList', label: '飙升榜', group: 'features', buildArgs: () => ['day'] },
  getHotStockList: { method: 'getHotStockList', label: '热门榜', group: 'features', buildArgs: () => ['day'] },
  getHotStockListHistory: {
    method: 'getHotStockListHistory',
    label: '历史热门榜',
    group: 'features',
    buildArgs: () => [ymd(-1)],
  },
  getHotStockRankTrend: {
    method: 'getHotStockRankTrend',
    label: '热度趋势',
    group: 'features',
    buildArgs: () => [A_SHARE, ymd(-7), ymd(0)],
  },
  getDragonTigerList: { method: 'getDragonTigerList', label: '龙虎榜', group: 'features', buildArgs: () => [{}] },

  // ================= 交易日历 =================
  getTradingDays: {
    method: 'getTradingDays',
    label: '交易日历',
    group: 'calendar',
    buildArgs: () => [],
    assertResult: nonEmptyRows<{ dateMs?: number; date?: string }>(d => {
      return num(d?.dateMs, 'dateMs') ?? nonEmptyStr(d?.date, 'date');
    }, '交易日历'),
  },
  isTradingDay: {
    method: 'isTradingDay',
    label: '是否交易日',
    group: 'calendar',
    buildArgs: () => [ymd(0)],
    assertResult: r => (typeof r === 'boolean' ? null : '返回值不是 boolean'),
  },
  nextTradingDay: {
    method: 'nextTradingDay',
    label: '下一交易日',
    group: 'calendar',
    buildArgs: () => [ymd(0)],
    assertResult: r => (typeof r === 'string' && r.length > 0 ? null : '返回值不是非空字符串'),
  },
  prevTradingDay: {
    method: 'prevTradingDay',
    label: '上一交易日',
    group: 'calendar',
    buildArgs: () => [ymd(0)],
    assertResult: r => (typeof r === 'string' && r.length > 0 ? null : '返回值不是非空字符串'),
  },

  // ================= 股东 / 榜单 =================
  getStockInfo: { method: 'getStockInfo', label: '个股档案', group: 'holder', buildArgs: () => ['600519'] },
  getHolders: { method: 'getHolders', label: '股东信息', group: 'holder', buildArgs: () => [{ symbol: A_SHARE }] },
  getLargestHolders: {
    method: 'getLargestHolders',
    label: '十大股东',
    group: 'holder',
    buildArgs: () => [{ symbol: A_SHARE }],
  },
  getHolderChanges: {
    method: 'getHolderChanges',
    label: '股东变动',
    group: 'holder',
    buildArgs: () => [{ symbol: A_SHARE }],
  },
  getTopList: { method: 'getTopList', label: '榜单', group: 'holder', buildArgs: () => [{}] },

  // ================= 资讯 / 公告 =================
  getNews: {
    method: 'getNews',
    label: '资讯',
    group: 'news',
    buildArgs: () => [{ market: 'A' as const, symbol: A_SHARE, limit: 5 }],
  },
  getAnnouncement: {
    method: 'getAnnouncement',
    label: '公告',
    group: 'news',
    buildArgs: () => [{ symbol: A_SHARE }],
  },

  // ================= 资金流 =================
  getMainForce: {
    method: 'getMainForce',
    label: '主力资金',
    group: 'capital',
    buildArgs: () => [{ symbol: A_SHARE, period: 'daily' as const }],
    assertResult: isArray('主力资金不是数组'),
  },
  getMarketHot: { method: 'getMarketHot', label: '市场热度', group: 'capital', buildArgs: () => [{}] },
  getStockHot: { method: 'getStockHot', label: '个股热度', group: 'capital', buildArgs: () => [{ code: '600519' }] },
  getStockFundsFlowing: {
    method: 'getStockFundsFlowing',
    label: '个股资金流',
    group: 'capital',
    buildArgs: () => [{ period: 'today' as const, limit: 20 }],
    assertResult: isArray('个股资金流不是数组'),
  },
  getStockHotIndustry: {
    method: 'getStockHotIndustry',
    label: '热门行业',
    group: 'capital',
    buildArgs: () => [{ period: 'today' as const }],
    assertResult: isArray('热门行业不是数组'),
  },
  getStockTodaySurge: {
    method: 'getStockTodaySurge',
    label: '今日异动',
    group: 'capital',
    buildArgs: () => [{ limit: 20 }],
    assertResult: isArray('今日异动不是数组'),
  },
  getStockIndustryBoard: {
    method: 'getStockIndustryBoard',
    label: '行业板块行情',
    group: 'capital',
    buildArgs: () => [{ limit: 20 }],
  },
  getStockIndustryFundsFlowing: {
    method: 'getStockIndustryFundsFlowing',
    label: '行业资金流',
    group: 'capital',
    buildArgs: () => [{ period: 'today' as const, sectorType: 'industry' as const }],
    assertResult: isArray('行业资金流不是数组'),
  },
  getIndustryBoardConstituents: {
    method: 'getIndustryBoardConstituents',
    label: '行业板块成分',
    group: 'index',
    buildArgs: () => [{ code: 'BK1027', exchange: 'SH' as const }],
    assertResult: isArray('行业成分不是数组'),
  },
  getIndustryBoardKline: {
    method: 'getIndustryBoardKline',
    label: '行业板块K线',
    group: 'index',
    buildArgs: () => [{ symbol: { code: 'BK1027', exchange: 'SH' as const }, period: 'daily' as const }],
    assertResult: isArray('行业K线不是数组'),
  },
  getSectorFundFlowHistory: {
    method: 'getSectorFundFlowHistory',
    label: '板块资金流历史',
    group: 'capital',
    buildArgs: () => [{ symbol: { code: 'BK1027', exchange: 'SH' as const }, period: 'daily' as const }],
    assertResult: isArray('板块资金流历史不是数组'),
  },
  getDragonTigerInstitution: {
    method: 'getDragonTigerInstitution',
    label: '龙虎榜机构',
    group: 'limit',
    buildArgs: () => [{ startDate: ymd(-7), endDate: ymd(0) }],
    assertResult: isArray('龙虎榜机构不是数组'),
  },
  getDragonTigerBranchRank: {
    method: 'getDragonTigerBranchRank',
    label: '龙虎榜营业部',
    group: 'limit',
    buildArgs: () => ['1month' as const],
    assertResult: isArray('营业部排行不是数组'),
  },
  getDragonTigerSeatDetail: {
    method: 'getDragonTigerSeatDetail',
    label: '龙虎榜席位',
    group: 'limit',
    buildArgs: () => [{ symbol: A_SHARE, date: ymd(-1) }],
    assertResult: isArray('席位明细不是数组'),
  },
  getBlockTradeMarketStat: {
    method: 'getBlockTradeMarketStat',
    label: '大宗市场统计',
    group: 'misc',
    buildArgs: () => [],
    assertResult: isArray('大宗市场统计不是数组'),
  },
  getBlockTradeDailyStat: {
    method: 'getBlockTradeDailyStat',
    label: '大宗日统计',
    group: 'misc',
    buildArgs: () => [{ startDate: ymd(-7), endDate: ymd(0) }],
    assertResult: isArray('大宗日统计不是数组'),
  },
  getDividendDetail: {
    method: 'getDividendDetail',
    label: '分红明细',
    group: 'features',
    buildArgs: () => [A_SHARE],
    assertResult: isArray('分红明细不是数组'),
  },

  // ================= 分时（统一入口） =================
  getIntraday: {
    method: 'getIntraday',
    label: '当日分时',
    group: 'timeshare',
    buildArgs: () => [{ symbol: A_SHARE }],
    assertResult: nonEmptyRows<{ time?: string | number; price?: number }>(p => {
      if (p?.time == null) return 'time 缺失';
      return num(p?.price, 'price');
    }, '分时'),
  },

  // ================= 其它 =================
  getAHPremium: { method: 'getAHPremium', label: 'A/H溢价', group: 'misc', buildArgs: () => [{}] },
  getStockNewStock: { method: 'getStockNewStock', label: '新股', group: 'misc', buildArgs: () => [{}] },
  getStockAH: { method: 'getStockAH', label: 'A/H列表', group: 'misc', buildArgs: () => [{}] },
  getStockTradingCalendar: {
    method: 'getStockTradingCalendar',
    label: '交易日历(扩)',
    group: 'calendar',
    buildArgs: () => [{}],
  },
  getBlockTrade: { method: 'getBlockTrade', label: '大宗交易', group: 'misc', buildArgs: () => [{ code: '600519' }] },

  // ================= 基金扩展 =================
  getFundList: { method: 'getFundList', label: '基金列表', group: 'fundExt', buildArgs: () => [{ size: 5 }] },
  getFundRank: { method: 'getFundRank', label: '基金排行', group: 'fundExt', buildArgs: () => [{}] },
  getFundValuation: {
    method: 'getFundValuation',
    label: '基金估值',
    group: 'fundExt',
    buildArgs: () => [{ code: '161725' }],
  },
  getFundBonus: { method: 'getFundBonus', label: '基金分红', group: 'fundExt', buildArgs: () => [{ code: '161725' }] },
  getFundAsset: { method: 'getFundAsset', label: '基金资产', group: 'fundExt', buildArgs: () => [{ code: '161725' }] },
  getFundManager: { method: 'getFundManager', label: '基金经理', group: 'fundExt', buildArgs: () => [{ code: '161725' }] },
  getFundNewFund: { method: 'getFundNewFund', label: '新发基金', group: 'fundExt', buildArgs: () => [{}] },
  getFundReits: { method: 'getFundReits', label: 'REITs', group: 'fundExt', buildArgs: () => [{}] },
  getFundTrades: { method: 'getFundTrades', label: '基金交易', group: 'fundExt', buildArgs: () => [{}] },
  getFundStock: { method: 'getFundStock', label: '基金重仓股', group: 'fundExt', buildArgs: () => [{ code: '161725' }] },
  getFundFinancing: { method: 'getFundFinancing', label: '基金融资', group: 'fundExt', buildArgs: () => [{}] },
  getFundPerformance: { method: 'getFundPerformance', label: '基金业绩', group: 'fundExt', buildArgs: () => [{}] },
  getFundReference: { method: 'getFundReference', label: '基金参考', group: 'fundExt', buildArgs: () => [{}] },
  getFundTheme: { method: 'getFundTheme', label: '基金主题', group: 'fundExt', buildArgs: () => [{}] },
  getFundShare: { method: 'getFundShare', label: '基金份额', group: 'fundExt', buildArgs: () => [{ code: '161725' }] },
  getFundTopics: { method: 'getFundTopics', label: '基金专题', group: 'fundExt', buildArgs: () => [{}] },
  getFundCategories: { method: 'getFundCategories', label: '基金分类', group: 'fundExt', buildArgs: () => [] },

  // ================= 期权 / 期货 =================
  getOptionQuotes: {
    method: 'getOptionQuotes',
    label: '期权T型报价',
    group: 'derivatives',
    buildArgs: () => [{ kind: 'index' as const, product: 'io' as const, contract: 'IO2409' }],
    assertResult: r => {
      const o = r as { calls?: unknown; puts?: unknown };
      if (!Array.isArray(o?.calls) || !Array.isArray(o?.puts)) return 'T型报价 calls/puts 不是数组';
      return null;
    },
  },
  getOptionKline: {
    method: 'getOptionKline',
    label: '期权日K',
    group: 'derivatives',
    buildArgs: () => [{ kind: 'etf' as const, code: '10004336' }],
    assertResult: isArray('期权K线不是数组'),
  },
  getOptionCffexQuotes: {
    method: 'getOptionCffexQuotes',
    label: '中金所期权行情',
    group: 'derivatives',
    buildArgs: () => [{}],
    assertResult: isArray('中金所期权行情不是数组'),
  },
  getOptionLhb: {
    method: 'getOptionLhb',
    label: '期权龙虎榜',
    group: 'derivatives',
    buildArgs: () => [{ symbol: A_SHARE, date: ymd(-1) }],
    assertResult: isArray('期权龙虎榜不是数组'),
  },
  getFuturesKline: {
    method: 'getFuturesKline',
    label: '期货K线',
    group: 'derivatives',
    buildArgs: () => [{ code: 'RB2410' }],
    assertResult: isArray('期货K线不是数组'),
  },
  getFuturesGlobalSpot: {
    method: 'getFuturesGlobalSpot',
    label: '全球期货行情',
    group: 'derivatives',
    buildArgs: () => [{}],
    assertResult: isArray('全球期货行情不是数组'),
  },
  getFuturesGlobalKline: {
    method: 'getFuturesGlobalKline',
    label: '全球期货K线',
    group: 'derivatives',
    buildArgs: () => [{ code: 'CLmain' }],
    assertResult: isArray('全球期货K线不是数组'),
  },
  getFuturesInventorySymbols: {
    method: 'getFuturesInventorySymbols',
    label: '期货库存品种',
    group: 'derivatives',
    buildArgs: () => [],
    assertResult: isArray('库存品种不是数组'),
  },
  getFuturesInventory: {
    method: 'getFuturesInventory',
    label: '期货库存',
    group: 'derivatives',
    buildArgs: () => [{ code: '铜' }],
    assertResult: isArray('期货库存不是数组'),
  },
  getFuturesComexInventory: {
    method: 'getFuturesComexInventory',
    label: 'COMEX库存',
    group: 'derivatives',
    buildArgs: () => [{ metal: 'gold' as const }],
    assertResult: isArray('COMEX库存不是数组'),
  },

  // ================= 北向资金 =================
  getNorthboundMinute: {
    method: 'getNorthboundMinute',
    label: '北向分时',
    group: 'northbound',
    buildArgs: () => ['north' as const],
    assertResult: isArray('北向分时不是数组'),
  },
  getNorthboundSummary: {
    method: 'getNorthboundSummary',
    label: '沪深港通汇总',
    group: 'northbound',
    buildArgs: () => [],
    assertResult: isArray('沪深港通汇总不是数组'),
  },
  getNorthboundHoldingRank: {
    method: 'getNorthboundHoldingRank',
    label: '北向持股排行',
    group: 'northbound',
    buildArgs: () => [{}],
    assertResult: isArray('北向持股排行不是数组'),
  },
  getNorthboundHistory: {
    method: 'getNorthboundHistory',
    label: '北向资金历史',
    group: 'northbound',
    buildArgs: () => [{}],
    assertResult: isArray('北向历史不是数组'),
  },
  getNorthboundIndividual: {
    method: 'getNorthboundIndividual',
    label: '个股北向持仓',
    group: 'northbound',
    buildArgs: () => [{ symbol: A_SHARE }],
    assertResult: isArray('个股北向持仓不是数组'),
  },

  // ================= 筹码 / 两融 =================
  getChipDistribution: {
    method: 'getChipDistribution',
    label: '筹码分布',
    group: 'features',
    buildArgs: () => [{ symbol: A_SHARE, range: 60 }],
    assertResult: isArray('筹码分布不是数组'),
  },
  getMarginAccountInfo: {
    method: 'getMarginAccountInfo',
    label: '两融账户统计',
    group: 'capital',
    buildArgs: () => [],
    assertResult: isArray('两融账户统计不是数组'),
  },
  getMarginTargetList: {
    method: 'getMarginTargetList',
    label: '两融标的列表',
    group: 'capital',
    buildArgs: () => [ymd(-1)],
    assertResult: isArray('两融标的不是数组'),
  },

  // ================= 概念板块 =================
  getConceptBoards: {
    method: 'getConceptBoards',
    label: '概念板块行情',
    group: 'index',
    buildArgs: () => [{ limit: 20 }],
    assertResult: isArray('概念板块不是数组'),
  },
  getConceptBoardConstituents: {
    method: 'getConceptBoardConstituents',
    label: '概念板块成分',
    group: 'index',
    buildArgs: () => [{ code: 'BK0493', exchange: 'SH' as const }],
    assertResult: isArray('概念成分不是数组'),
  },
  getConceptBoardKline: {
    method: 'getConceptBoardKline',
    label: '概念板块K线',
    group: 'index',
    buildArgs: () => [{ symbol: { code: 'BK0493', exchange: 'SH' as const }, period: 'daily' as const }],
    assertResult: isArray('概念K线不是数组'),
  },
};

/** 运行时方法名清单（类型已保证完整） */
export const ALL_METHODS = Object.keys(METHOD_CATALOG) as DataSourceMethod[];

/** 取方法目录项（返回值已按 method 收窄） */
export function catalogOf<M extends DataSourceMethod>(method: M): Extract<MethodCatalogEntry, { method: M }> {
  return METHOD_CATALOG[method];
}

/** 按分组顺序取出全部目录项 */
export function catalogByGroup(): { key: MethodGroupKey; title: string; items: MethodCatalogEntry[] }[] {
  const all = Object.values(METHOD_CATALOG) as MethodCatalogEntry[];
  return METHOD_GROUP_ORDER.map(key => ({
    key,
    title: METHOD_GROUP_TITLES[key],
    items: all.filter(i => i.group === key),
  }));
}
