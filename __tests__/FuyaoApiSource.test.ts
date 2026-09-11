/**
 * FuyaoApiSource 单元测试：验证 SDK 类型化调用 + 字段归一化 + 错误归一化。
 * mock @opptrix/fuyao 的 FuyaoClient，不发起真实网络。
 */
import { FuyaoApiSource } from '@/data/api/sources/FuyaoApiSource';
import { FuyaoApiError } from '@opptrix/fuyao';
import type { Symbol } from '@/data/api';

const SYM: Symbol = { code: '600519', exchange: 'SH', name: '贵州茅台' };

// ---- mock FuyaoClient ----
const mockInstances: any[] = [];
jest.mock('@opptrix/fuyao', () => {
  const Actual = jest.requireActual('@opptrix/fuyao');
  class MockFuyaoClient {
    meta: any;
    aShare: any;
    index: any;
    specialData: any;
    funds: any;
    constructor(opts: { apiKey: string }) {
      mockInstances.push(opts);
      this.meta = { search: jest.fn(), listTickers: jest.fn() };
      this.aShare = {
        prices: { snapshot: jest.fn(), historical: jest.fn() },
        corporateActions: { adjustmentFactors: jest.fn() },
        financials: { incomeStatements: jest.fn(), balanceSheets: jest.fn(), cashFlowStatements: jest.fn(), indicators: jest.fn() },
        valuations: { snapshot: jest.fn() },
        calendar: { tradingDays: jest.fn() },
      };
      this.index = {
        catalogThsIndexList: jest.fn(),
        constituentsThsStockList: jest.fn(),
        pricesSnapshot: jest.fn(),
        pricesHistorical: jest.fn(),
      };
      this.specialData = {
        limitUpPool: jest.fn(), limitUpLadder: jest.fn(), anomalyAnalysisList: jest.fn(),
        anomalyAnalysisStock: jest.fn(), skyrocketList: jest.fn(), hotStockList: jest.fn(),
        hotStockListHistory: jest.fn(), hotStockRankTrend: jest.fn(), dragonTigerList: jest.fn(),
      };
      this.funds = {
        profile: { detail: jest.fn() },
        portfolio: { holdings: jest.fn() },
        performance: { nav: jest.fn(), returns: jest.fn() },
        holders: { detail: jest.fn() },
        market: { snapshot: jest.fn(), historical: jest.fn() },
      };
    }
  }
  return { ...Actual, FuyaoClient: MockFuyaoClient };
});

function src(key = 'test-key') {
  return new FuyaoApiSource(() => key);
}

/** 造一个已构造 client 的源实例 */
function prepared(key = 'test-key') {
  const s = src(key);
  // 触发 get() 懒构造
  (s as any).get();
  return s;
}

function clientOf(s: FuyaoApiSource): any {
  return (s as any).client;
}

beforeEach(() => {
  mockInstances.length = 0;
  jest.clearAllMocks();
});

describe('FuyaoApiSource.getKline', () => {
  it('周期映射 day->1d + 复权 + 字段归一化', async () => {
    const s = prepared();
    const hist = clientOf(s).aShare.prices.historical;
    hist.mockResolvedValueOnce({
      code: 0, message: '', request_id: 'x', data: {
        timestamp: 1,
        item: [{ date_ms: 1704067200000, open_price: 100, high_price: 105, low_price: 99, close_price: 104, volume: 1000, turnover: 104000 }],
      },
    });
    const candles = await s.getKline({ symbol: SYM, period: 'day', count: 100, adjust: 'forward' });
    expect(hist).toHaveBeenCalledWith(expect.objectContaining({
      thscode: '600519.SH', interval: '1d', adjust: 'forward',
    }));
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({ open: 100, high: 105, low: 99, close: 104, volume: 1000, amount: 104000 });
  });

  it('周/月映射为 1w/1mo', async () => {
    const s = prepared();
    const hist = clientOf(s).aShare.prices.historical;
    hist.mockResolvedValueOnce({ code: 0, message: '', request_id: 'x', data: { timestamp: 1, item: [] } });
    await s.getKline({ symbol: SYM, period: 'week', count: 50 });
    expect(hist.mock.calls[0][0].interval).toBe('1w');
    hist.mockResolvedValueOnce({ code: 0, message: '', request_id: 'x', data: { timestamp: 1, item: [] } });
    await s.getKline({ symbol: SYM, period: 'month', count: 50 });
    expect(hist.mock.calls[1][0].interval).toBe('1mo');
  });

  it('分钟周期抛 3004 不支持', async () => {
    const s = prepared();
    await expect(s.getKline({ symbol: SYM, period: '1m', count: 100 })).rejects.toMatchObject({ upstreamCode: 3004 });
  });

  it('请求窗口被钳制在 10 年内', async () => {
    const s = prepared();
    const hist = clientOf(s).aShare.prices.historical;
    hist.mockResolvedValueOnce({ code: 0, message: '', request_id: 'x', data: { timestamp: 1, item: [] } });
    await s.getKline({ symbol: SYM, period: 'month', count: 250 }); // 31*250 天 > 10 年
    const { start, end } = hist.mock.calls[0][0];
    expect(end - start).toBeLessThanOrEqual(10 * 365 * 24 * 3600 * 1000);
  });
});

describe('FuyaoApiSource.getQuotes', () => {
  it('批量快照按入参顺序返回，字段完整映射', async () => {
    const s = prepared();
    const snap = clientOf(s).aShare.prices.snapshot;
    snap.mockResolvedValueOnce({
      code: 0, message: '', request_id: 'x', data: {
        timestamp: 1, total: 1,
        item: [{
          thscode: '600519.SH', last_price: 1500, prev_price: 1480, open_price: 1490,
          high_price: 1510, low_price: 1485, volume: 1000, turnover: 1500000,
          price_change: 20, price_change_ratio_pct: 1.35,
        }],
      },
    });
    const quotes = await s.getQuotes([SYM]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      symbol: { code: '600519', exchange: 'SH' },
      last: 1500,
      prevClose: 1480,
      open: 1490,
      high: 1510,
      low: 1485,
      volume: 1000,
      amount: 1500000,
      change: 20,
      changePct: 1.35,
    });
  });

  it('上游无 last_price 的行被过滤，不伪造 0 价', async () => {
    const s = prepared();
    const snap = clientOf(s).aShare.prices.snapshot;
    snap.mockResolvedValueOnce({
      code: 0, message: '', request_id: 'x', data: {
        timestamp: 1, total: 1,
        item: [{ thscode: '600519.SH', volume: 100 }],
      },
    });
    const quotes = await s.getQuotes([SYM]);
    expect(quotes).toHaveLength(0);
  });
});

describe('FuyaoApiSource 估值/指数/交易日历', () => {
  it('getValuations 字段映射', async () => {
    const s = prepared();
    const snap = clientOf(s).aShare.valuations.snapshot;
    snap.mockResolvedValueOnce({
      code: 0, message: '', request_id: 'x', data: {
        timestamp: 9, total: 1,
        item: [{ thscode: '600519.SH', ticker: '600519', name: '贵州茅台', pe_ttm: 30, pe_mrq: 29, pb_mrq: 8, ps_ttm: 20, pcf_ttm: 25 }],
      },
    });
    const vals = await s.getValuations([SYM]);
    expect(vals[0]).toMatchObject({ symbol: { code: '600519', exchange: 'SH' }, peTtm: 30, peMrq: 29, pbMrq: 8, psTtm: 20, pcfTtm: 25 });
  });

  it('getIndexKline 仅日线', async () => {
    const s = prepared();
    await expect(s.getIndexKline({ symbol: SYM, period: 'week' })).rejects.toMatchObject({ upstreamCode: 3004 });
  });

  it('getTradingDays 日期格式 yyyyMMdd -> yyyy-MM-dd', async () => {
    const s = prepared();
    const td = clientOf(s).aShare.calendar.tradingDays;
    td.mockResolvedValueOnce({ code: 0, message: '', request_id: 'x', data: { timestamp: 1, item: [{ date_ms: 1704067200000, date: '20240102' }] } });
    const days = await s.getTradingDays();
    expect(days[0]).toEqual({ dateMs: 1704067200000, date: '2024-01-02' });
  });
});

describe('FuyaoApiSource 错误归一化', () => {
  it('FuyaoApiError -> DataSourceError 携带上游 code', async () => {
    const s = prepared();
    const hist = clientOf(s).aShare.prices.historical;
    hist.mockRejectedValueOnce(new FuyaoApiError(3001, '标的不存在', 'rid', '/api/a-share/prices/historical'));
    await expect(s.getKline({ symbol: SYM, period: 'day' })).rejects.toMatchObject({ upstreamCode: 3001 });
  });

  it('未配置 Key 时抛错', async () => {
    // 注意：不能用 src() 默认参数（undefined 会被替换成 'test-key'），直接构造无 Key 源
    const s = new FuyaoApiSource(() => undefined);
    await expect(s.getKline({ symbol: SYM, period: 'day' })).rejects.toMatchObject({ upstreamCode: 2001 });
  });

  it('init 懒构造：首次调用时读取一次 Key', async () => {
    const s = src('my-key');
    (s as any).get();
    expect(mockInstances).toHaveLength(1);
    expect(mockInstances[0].apiKey).toBe('my-key');
  });
});

describe('FuyaoApiSource.getFinancials', () => {
  it('按报告期合并三大报表为统一 FinancialReport[]', async () => {
    const s = prepared();
    const fin = clientOf(s).aShare.financials;
    fin.incomeStatements.mockResolvedValueOnce({
      code: 0, message: '', request_id: 'x', data: {
        item: [{ period: 'annual', period_end_ms: 1735660800000, basic_eps: 68.08, operating_income: 1505600000000, operating_costs: 340000000000, net_profit: 860000000000, parent_holder_net_profit: 862280000000 }],
      },
    });
    fin.balanceSheets.mockResolvedValueOnce({
      code: 0, message: '', request_id: 'x', data: {
        item: [{ period: 'annual', period_end_ms: 1735660800000, assets_total: 2900000000000, holder_equity_total: 2500000000000 }],
      },
    });
    fin.cashFlowStatements.mockResolvedValueOnce({
      code: 0, message: '', request_id: 'x', data: {
        item: [{ period: 'annual', period_end_ms: 1735660800000, act_cash_flow_net: 210000000000 }],
      },
    });

    const reports = await s.getFinancials('600519.SH');
    expect(reports).toHaveLength(1);
    const r = reports[0];
    expect(r.periodEndMs).toBe(1735660800000);
    expect(r.basicEps).toBe(68.08);
    expect(r.operatingIncome).toBe(1505600000000);
    expect(r.totalAssets).toBe(2900000000000);
    expect(r.holderEquityTotal).toBe(2500000000000);
    expect(r.operatingCashFlow).toBe(210000000000);
  });

  it('按报告期倒序返回多期报表', async () => {
    const s = prepared();
    const fin = clientOf(s).aShare.financials;
    fin.incomeStatements.mockResolvedValueOnce({
      code: 0, message: '', request_id: 'x', data: {
        item: [
          { period: 'annual', period_end_ms: 1704067200000, net_profit: 700000000000 },
          { period: 'annual', period_end_ms: 1735660800000, net_profit: 860000000000 },
        ],
      },
    });
    fin.balanceSheets.mockResolvedValueOnce({ code: 0, message: '', request_id: 'x', data: { item: [] } });
    fin.cashFlowStatements.mockResolvedValueOnce({ code: 0, message: '', request_id: 'x', data: { item: [] } });

    const reports = await s.getFinancials('600519.SH');
    expect(reports.map((r) => r.periodEndMs)).toEqual([1735660800000, 1704067200000]);
  });

  it('三表某表失败时降级返回其余数据', async () => {
    const s = prepared();
    const fin = clientOf(s).aShare.financials;
    fin.incomeStatements.mockRejectedValueOnce(new Error('income fail'));
    fin.balanceSheets.mockResolvedValueOnce({
      code: 0, message: '', request_id: 'x', data: {
        item: [{ period: 'annual', period_end_ms: 1735660800000, assets_total: 2900000000000, holder_equity_total: 2500000000000 }],
      },
    });
    fin.cashFlowStatements.mockResolvedValueOnce({
      code: 0, message: '', request_id: 'x', data: {
        item: [{ period: 'annual', period_end_ms: 1735660800000, act_cash_flow_net: 210000000000 }],
      },
    });

    const reports = await s.getFinancials('600519.SH');
    expect(reports).toHaveLength(1);
    expect(reports[0].totalAssets).toBe(2900000000000);
    expect(reports[0].operatingCashFlow).toBe(210000000000);
    expect(reports[0].basicEps).toBeUndefined();
  });
});

describe('FuyaoApiSource.supports —— 仅沪深(SH/SZ)标的上报行情', () => {
  const s = src();
  const BJ: Symbol = { code: '899050', exchange: 'BJ', name: '北交所股' };
  const HK: Symbol = { code: '00700', exchange: 'HK', name: '腾讯控股' };
  const US: Symbol = { code: 'AAPL', exchange: 'US', name: '苹果' };

  it('getQuotes 含非沪深标的返回 false（路由 stock-sdk 兜底）', () => {
    expect(s.supports('getQuotes', [[SYM]])).toBe(true);
    expect(s.supports('getQuotes', [[SYM, BJ]])).toBe(false);
    expect(s.supports('getQuotes', [[BJ]])).toBe(false);
    expect(s.supports('getQuotes', [[HK]])).toBe(false);
    expect(s.supports('getQuotes', [[SYM, HK]])).toBe(false);
    expect(s.supports('getQuotes', [[US]])).toBe(false);
  });

  it('getValuations 含非沪深标的返回 false', () => {
    expect(s.supports('getValuations', [[SYM]])).toBe(true);
    expect(s.supports('getValuations', [[BJ]])).toBe(false);
    expect(s.supports('getValuations', [[HK]])).toBe(false);
  });

  it('getKline 单标：SH true，BJ/HK/US false', () => {
    expect(s.supports('getKline', [{ symbol: SYM, period: 'day' }])).toBe(true);
    expect(s.supports('getKline', [{ symbol: BJ, period: 'day' }])).toBe(false);
    expect(s.supports('getKline', [{ symbol: HK, period: 'day' }])).toBe(false);
  });

  it('getOrderBook 单标：SH true，BJ/HK false', () => {
    expect(s.supports('getOrderBook', [SYM])).toBe(true);
    expect(s.supports('getOrderBook', [BJ])).toBe(false);
    expect(s.supports('getOrderBook', [HK])).toBe(false);
  });

  it('其它不涉及标的方法默认支持', () => {
    expect(s.supports('search', [{ keyword: '茅台' }])).toBe(true);
    expect(s.supports('getLimitUpPool', [{}])).toBe(true);
  });
});
