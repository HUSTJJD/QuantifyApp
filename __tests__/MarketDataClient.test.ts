/**
 * MarketDataClient（APP 唯一数据访问点）逐接口测试 + 优先级调度测试。
 *
 * 本测试不联网，用可控 mock 源隔离注册表，验证：
 *   1. resolveOrder 能力矩阵裁剪 + 优先级（同花顺 > stock-sdk > stock-api）；
 *   2. 每个对外方法都按优先级正确路由 / 在专属源上调用；
 *   3. 参数级裁剪（同花顺仅支持 A 股日/周 K；港股/美股落到 stock-api；盘口 sdk 优先）；
 *   4. 全部失败聚合错误。
 *
 * 优先级：hithsa(同花顺) > stock-sdk > stock-api > fund-api。
 */
import { MarketDataClient } from '@/api/MarketDataClient';
import { setApiConfig, defaultApiConfig } from '@/api/config';
import type { MarketDataSource } from '@/api/MarketDataSource';
import type { Symbol } from '@/api/types';

const A: Symbol = { code: '600519', exchange: 'SH', name: '贵州茅台' };
const HK: Symbol = { code: '00700', exchange: 'HK', name: '腾讯控股' };
const US: Symbol = { code: 'AAPL', exchange: 'US', name: '苹果' };
const EMPTY: any[] = []; // 合法空数组，避免写入缓存 .map 失败

/** 一个可控 mock 源：按方法名决定「是否原生支持」，可配置返回值 / 抛错 */
function makeMockSource(
  id: string,
  opts: { supported?: string[]; failAlways?: boolean; overload?: Record<string, unknown> } = {},
): { source: MarketDataSource; calls: Record<string, jest.Mock> } {
  const supported = new Set(opts.supported ?? []);
  const mk = (name: string) =>
    jest.fn(async (...args: unknown[]) => {
      if (opts.failAlways || !supported.has(name)) throw new Error(`${id} 不支持 ${name}`);
      if (name in (opts.overload ?? {})) return (opts.overload as any)[name];
      return name.startsWith('get') && /Kline|Quotes|OrderBook|search|List|News|Hot|Holder|Top|Limit|Dragon|Time|Fund|Block|Main|Announcement|Market|Stock|AH|Trading|Industry|Today|Surge|Reits|Trade|Financing|Performance|Reference|Theme|Topic|Category|New|Valuation|Bonus|Asset|Manager|Share|Rank|Info|History|Financial|Profit/.test(name)
        ? EMPTY
        : EMPTY;
    });

  const methodNames = [
    'search', 'getQuotes', 'getKline', 'getOrderBook', 'getIndexKline', 'getFinancials', 'getProfitForecast',
    'getUsQuotes', 'getHkQuotes', 'getFundList', 'getFundInfo', 'getFundHistory', 'getFundRank', 'getFundValuation',
    'getFundBonus', 'getFundAsset', 'getFundManager', 'getFundNewFund', 'getFundReits', 'getFundTrades',
    'getFundStock', 'getFundFinancing', 'getFundPerformance', 'getFundReference', 'getFundTheme', 'getFundShare',
    'getFundTopics', 'getFundCategories', 'getBlockTrade', 'getNews', 'getHKNews', 'getFinanceNews', 'getAnnouncement',
    'getMainForce', 'getMarketHot', 'getStockHot', 'getStockInfo', 'getHolders', 'getLargestHolders', 'getHolderChanges',
    'getTopList', 'getStockLimitUp', 'getStockLimitDown', 'getStockLimitUpList', 'getStockLimitDownList', 'getDragonTiger',
    'getStockTimeSharing', 'getUsTimeSharing', 'getTimeSharing', 'getUsKline', 'getHkKline', 'getAHPremium',
    'getStockNewStock', 'getStockAH', 'getStockTradingCalendar', 'getStockFundsFlowing', 'getStockHotIndustry',
    'getStockTodaySurge', 'getStockIndustryBoard', 'getStockIndustryFundsFlowing', 'getStockLimitUpPool',
    // hithsa 专属深度能力
    'getAdjustmentFactors', 'getValuations', 'getIncomeStatements', 'getBalanceSheets', 'getCashFlowStatements',
    'getFinancialIndicators', 'listIndices', 'getIndexConstituents', 'getFundProfile', 'getFundHoldings', 'getFundNav',
    'getFundReturns', 'getFundHolders', 'getFundMarketSnapshot', 'getFundHistorical', 'getLimitUpPool', 'getLimitUpLadder',
    'getAnomalyList', 'getAnomalyByStocks', 'getSkyrocketList', 'getHotStockList', 'getHotStockListHistory',
    'getHotStockRankTrend', 'getDragonTigerList', 'getTradingDays',
  ];
  const calls: Record<string, jest.Mock> = {};
  methodNames.forEach((m) => (calls[m] = mk(m)));

  const source: any = {
    id,
    label: id,
    async init() {},
    async dispose() {},
    // 模仿真实源的能力裁剪
    supports(method: string, args: unknown[]): boolean {
      if (id === 'hithsa') {
        if (method === 'getKline') return (args[0] as any)?.period === 'day'; // 仅 A 股日线
        if (method === 'getIndexKline' || method === 'getOrderBook') return false; // 同花顺无端点
        return true;
      }
      if (method === 'getKline') {
        // sdk / api 支持日/周/月
        return ['day', 'week', 'month'].includes((args[0] as any)?.period);
      }
      return true;
    },
  };
  methodNames.forEach((m) => (source[m] = calls[m]));
  return { source: source as MarketDataSource, calls };
}

function buildClient(sources: Record<string, MarketDataSource>): MarketDataClient {
  const factory = (id: string) => {
    const s = sources[id];
    if (!s) throw new Error(`no source ${id}`);
    return s;
  };
  return new (MarketDataClient as any)({ sourceFactory: factory }) as MarketDataClient;
}

/** 四个源的真实能力矩阵 */
const CAPABILITY = {
  hithsa: ['search', 'getQuotes', 'getKline', 'getFinancials', 'getProfitForecast'],
  'stock-sdk': [
    'search', 'getQuotes', 'getKline', 'getOrderBook', 'getIndexKline', 'getBlockTrade', 'getNews', 'getHKNews',
    'getFinanceNews', 'getAnnouncement', 'getMainForce', 'getMarketHot', 'getStockHot', 'getStockInfo', 'getHolders',
    'getLargestHolders', 'getHolderChanges', 'getTopList', 'getStockLimitUp', 'getStockLimitDown', 'getStockLimitUpList',
    'getStockLimitDownList', 'getDragonTiger', 'getStockTimeSharing', 'getUsTimeSharing', 'getTimeSharing', 'getUsKline',
    'getHkKline', 'getAHPremium', 'getStockNewStock', 'getStockAH', 'getStockFundsFlowing', 'getStockIndustryBoard',
    'getStockIndustryFundsFlowing', 'getStockLimitUpPool',
  ],
  'stock-api': [
    'getQuotes', 'getKline', 'getOrderBook', 'getIndexKline', 'getFinancials', 'getUsQuotes', 'getHkQuotes',
    'getStockTradingCalendar', 'getStockHotIndustry', 'getStockTodaySurge',
  ],
  'fund-api': [
    'getFundList', 'getFundInfo', 'getFundHistory', 'getFundRank', 'getFundValuation', 'getFundBonus', 'getFundAsset',
    'getFundManager', 'getFundNewFund', 'getFundReits', 'getFundTrades', 'getFundStock', 'getFundFinancing',
    'getFundPerformance', 'getFundReference', 'getFundTheme', 'getFundShare', 'getFundTopics', 'getFundCategories',
  ],
};

describe('resolveOrder —— 能力矩阵裁剪 + 优先级', () => {
  const probe = new MarketDataClient({ sourceFactory: () => ({}) as any });
  beforeEach(() =>
    setApiConfig({ ...defaultApiConfig, primary: 'hithsa', fallback: 'stock-sdk', extraFallbacks: ['stock-api', 'fund-api'] }),
  );

  it('A股日K：同花顺支持 -> 优先同花顺', () => {
    expect((probe as any).resolveOrder('getKline', [{ symbol: A, period: 'day' }])).toEqual(['hithsa', 'stock-sdk', 'stock-api']);
  });
  it('A股周K：方法级三源都支持（参数级裁剪在运行时发生）', () => {
    expect((probe as any).resolveOrder('getKline', [{ symbol: A, period: 'week' }])).toEqual(['hithsa', 'stock-sdk', 'stock-api']);
  });
  it('A股月K：方法级三源都支持（参数级裁剪在运行时发生）', () => {
    expect((probe as any).resolveOrder('getKline', [{ symbol: A, period: 'month' }])).toEqual(['hithsa', 'stock-sdk', 'stock-api']);
  });
  it('港股行情：仅 stock-api 支持 -> 唯一', () => {
    expect((probe as any).resolveOrder('getHkQuotes', [{ codes: ['00700'] }])).toEqual(['stock-api']);
  });
  it('美股行情：仅 stock-api 支持 -> 唯一', () => {
    expect((probe as any).resolveOrder('getUsQuotes', [{ codes: ['AAPL'] }])).toEqual(['stock-api']);
  });
  it('五档盘口：sdk 真实盘口优先于 api（重排）', () => {
    expect((probe as any).resolveOrder('getOrderBook', [A])).toEqual(['stock-sdk', 'stock-api']);
  });
  it('基金：exclusive，仅 fund-api', () => {
    expect((probe as any).resolveOrder('getFundList', [])).toEqual(['fund-api']);
    expect((probe as any).resolveOrder('getFundInfo', ['000001'])).toEqual(['fund-api']);
  });
  it('特色数据（龙虎榜）：仅 stock-sdk', () => {
    expect((probe as any).resolveOrder('getDragonTiger', [])).toEqual(['stock-sdk']);
  });
});

describe('MarketDataClient —— 按优先级路由所有接口', () => {
  let client: MarketDataClient;
  let hithsa: ReturnType<typeof makeMockSource>;
  let sdk: ReturnType<typeof makeMockSource>;
  let api: ReturnType<typeof makeMockSource>;
  let fund: ReturnType<typeof makeMockSource>;

  beforeEach(() => {
    setApiConfig({ ...defaultApiConfig, primary: 'hithsa', fallback: 'stock-sdk', extraFallbacks: ['stock-api', 'fund-api'] });
    hithsa = makeMockSource('hithsa', { supported: CAPABILITY.hithsa });
    sdk = makeMockSource('stock-sdk', { supported: CAPABILITY['stock-sdk'] });
    api = makeMockSource('stock-api', { supported: CAPABILITY['stock-api'] });
    fund = makeMockSource('fund-api', { supported: CAPABILITY['fund-api'] });
    client = buildClient({ hithsa: hithsa.source, 'stock-sdk': sdk.source, 'stock-api': api.source, 'fund-api': fund.source });
  });

  it('A股日K：命中同花顺', async () => {
    await client.getKline({ symbol: A, period: 'day' });
    expect(hithsa.calls.getKline).toHaveBeenCalledTimes(1);
    expect(sdk.calls.getKline).not.toHaveBeenCalled();
    expect(api.calls.getKline).not.toHaveBeenCalled();
  });

  it('A股月K：同花顺跳过，落到 stock-sdk', async () => {
    await client.getKline({ symbol: A, period: 'month' });
    expect(hithsa.calls.getKline).not.toHaveBeenCalled();
    expect(sdk.calls.getKline).toHaveBeenCalledTimes(1);
    expect(api.calls.getKline).not.toHaveBeenCalled();
  });

  it('A股行情：同花顺优先', async () => {
    await client.getQuotes({ symbols: [A] });
    expect(hithsa.calls.getQuotes).toHaveBeenCalledTimes(1);
  });

  it('港股行情：仅 stock-api', async () => {
    await client.getHkQuotes({ codes: ['00700'] });
    expect(api.calls.getHkQuotes).toHaveBeenCalledTimes(1);
  });

  it('美股行情：仅 stock-api', async () => {
    await client.getUsQuotes({ codes: ['AAPL'] });
    expect(api.calls.getUsQuotes).toHaveBeenCalledTimes(1);
  });

  it('盘口：sdk 真实优先，成功即止', async () => {
    await client.getOrderBook(A);
    expect(sdk.calls.getOrderBook).toHaveBeenCalledTimes(1);
    expect(api.calls.getOrderBook).not.toHaveBeenCalled();
  });

  it('搜索：同花顺优先', async () => {
    await client.search('茅台');
    expect(hithsa.calls.search).toHaveBeenCalledTimes(1);
  });

  it('财务：同花顺优先', async () => {
    await client.getFinancials('600519');
    expect(hithsa.calls.getFinancials).toHaveBeenCalledTimes(1);
  });

  it('业绩预测：仅同花顺', async () => {
    await client.getProfitForecast('600519');
    expect(hithsa.calls.getProfitForecast).toHaveBeenCalledTimes(1);
  });

  it('指数K线：同花顺不支持，stock-sdk > stock-api', async () => {
    await client.getIndexKline({ indexCode: '000001', period: 'day' });
    expect(sdk.calls.getIndexKline).toHaveBeenCalledTimes(1);
    expect(api.calls.getIndexKline).not.toHaveBeenCalled();
  });

  // —— 基金全系：仅 fund-api ——
  const fundMethods: Array<[string, () => Promise<unknown>, unknown[]]> = [
    ['getFundList', () => client.getFundList({ type: 'all' }), [{}]],
    ['getFundInfo', () => client.getFundInfo('000001'), ['000001']],
    ['getFundHistory', () => client.getFundHistory({ code: '000001' }), [{}]],
    ['getFundRank', () => client.getFundRank({ type: 'all' }), [{}]],
    ['getFundValuation', () => client.getFundValuation({ code: '000001' }), [{}]],
    ['getFundBonus', () => client.getFundBonus({ code: '000001' }), [{}]],
    ['getFundAsset', () => client.getFundAsset({ code: '000001' }), [{}]],
    ['getFundManager', () => client.getFundManager({ code: '000001' }), [{}]],
    ['getFundNewFund', () => client.getFundNewFund(), [undefined]],
    ['getFundReits', () => client.getFundReits(), [undefined]],
    ['getFundTrades', () => client.getFundTrades(), [undefined]],
    ['getFundStock', () => client.getFundStock({ code: '000001' }), [{}]],
    ['getFundFinancing', () => client.getFundFinancing(), [undefined]],
    ['getFundPerformance', () => client.getFundPerformance(), [undefined]],
    ['getFundReference', () => client.getFundReference(), [undefined]],
    ['getFundTheme', () => client.getFundTheme(), [undefined]],
    ['getFundShare', () => client.getFundShare({ code: '000001' }), [{}]],
    ['getFundTopics', () => client.getFundTopics(), [undefined]],
    ['getFundCategories', () => client.getFundCategories(), []],
  ];
  fundMethods.forEach(([name, fn]) =>
    it(`基金接口 ${name}：仅 fund-api`, async () => {
      await fn();
      expect(fund.calls[name]).toHaveBeenCalledTimes(1);
    }),
  );

  // —— 资讯 / 公告 / 资金流（stock-sdk） ——
  it('资讯 getNews：stock-sdk', async () => {
    await client.getNews({});
    expect(sdk.calls.getNews).toHaveBeenCalledTimes(1);
  });
  it('港股资讯 getHKNews：stock-sdk', async () => {
    await client.getHKNews({});
    expect(sdk.calls.getHKNews).toHaveBeenCalledTimes(1);
  });
  it('财经资讯 getFinanceNews：stock-sdk', async () => {
    await client.getFinanceNews({});
    expect(sdk.calls.getFinanceNews).toHaveBeenCalledTimes(1);
  });
  it('公告 getAnnouncement：stock-sdk', async () => {
    await client.getAnnouncement({ code: '600519' });
    expect(sdk.calls.getAnnouncement).toHaveBeenCalledTimes(1);
  });
  it('大宗交易 getBlockTrade：stock-sdk', async () => {
    await client.getBlockTrade({});
    expect(sdk.calls.getBlockTrade).toHaveBeenCalledTimes(1);
  });
  it('主力资金 getMainForce：stock-sdk', async () => {
    await client.getMainForce({ code: '600519' });
    expect(sdk.calls.getMainForce).toHaveBeenCalledTimes(1);
  });
  it('市场热度 getMarketHot：stock-sdk', async () => {
    await client.getMarketHot();
    expect(sdk.calls.getMarketHot).toHaveBeenCalledTimes(1);
  });
  it('个股热度 getStockHot：stock-sdk', async () => {
    await client.getStockHot();
    expect(sdk.calls.getStockHot).toHaveBeenCalledTimes(1);
  });

  // —— 个股档案 / 股东 / 龙虎榜（stock-sdk） ——
  it('个股档案 getStockInfo：stock-sdk', async () => {
    await client.getStockInfo('600519');
    expect(sdk.calls.getStockInfo).toHaveBeenCalledTimes(1);
  });
  it('股东 getHolders：stock-sdk', async () => {
    await client.getHolders({ code: '600519' });
    expect(sdk.calls.getHolders).toHaveBeenCalledTimes(1);
  });
  it('十大股东 getLargestHolders：stock-sdk', async () => {
    await client.getLargestHolders({ code: '600519' });
    expect(sdk.calls.getLargestHolders).toHaveBeenCalledTimes(1);
  });
  it('股东变化 getHolderChanges：stock-sdk', async () => {
    await client.getHolderChanges({ code: '600519' });
    expect(sdk.calls.getHolderChanges).toHaveBeenCalledTimes(1);
  });
  it('龙虎榜列表 getTopList：stock-sdk', async () => {
    await client.getTopList({});
    expect(sdk.calls.getTopList).toHaveBeenCalledTimes(1);
  });
  it('涨停 getStockLimitUp：stock-sdk', async () => {
    await client.getStockLimitUp();
    expect(sdk.calls.getStockLimitUp).toHaveBeenCalledTimes(1);
  });
  it('跌停 getStockLimitDown：stock-sdk', async () => {
    await client.getStockLimitDown();
    expect(sdk.calls.getStockLimitDown).toHaveBeenCalledTimes(1);
  });
  it('涨停池 getStockLimitUpPool：stock-sdk', async () => {
    await client.getStockLimitUpPool();
    expect(sdk.calls.getStockLimitUpPool).toHaveBeenCalledTimes(1);
  });
  it('龙虎榜 getDragonTiger：stock-sdk', async () => {
    await client.getDragonTiger();
    expect(sdk.calls.getDragonTiger).toHaveBeenCalledTimes(1);
  });

  // —— 分时 / 美股港股 K线（stock-sdk） ——
  it('A股分时 getStockTimeSharing：stock-sdk', async () => {
    await client.getStockTimeSharing({ code: '600519' });
    expect(sdk.calls.getStockTimeSharing).toHaveBeenCalledTimes(1);
  });
  it('美股分时 getUsTimeSharing：stock-sdk', async () => {
    await client.getUsTimeSharing({ code: 'AAPL' });
    expect(sdk.calls.getUsTimeSharing).toHaveBeenCalledTimes(1);
  });
  it('通用分时 getTimeSharing：stock-sdk', async () => {
    await client.getTimeSharing({ code: '600519' });
    expect(sdk.calls.getTimeSharing).toHaveBeenCalledTimes(1);
  });
  it('美股K线 getUsKline：stock-sdk', async () => {
    await client.getUsKline({ code: 'AAPL' });
    expect(sdk.calls.getUsKline).toHaveBeenCalledTimes(1);
  });
  it('港股K线 getHkKline：stock-sdk', async () => {
    await client.getHkKline({ code: '00700' });
    expect(sdk.calls.getHkKline).toHaveBeenCalledTimes(1);
  });

  // —— A/H / 新股 / 日历 / 资金流 ——
  it('A/H溢价 getAHPremium：stock-sdk', async () => {
    await client.getAHPremium();
    expect(sdk.calls.getAHPremium).toHaveBeenCalledTimes(1);
  });
  it('新股 getStockNewStock：stock-sdk', async () => {
    await client.getStockNewStock();
    expect(sdk.calls.getStockNewStock).toHaveBeenCalledTimes(1);
  });
  it('AH股 getStockAH：stock-sdk', async () => {
    await client.getStockAH();
    expect(sdk.calls.getStockAH).toHaveBeenCalledTimes(1);
  });
  it('交易日历 getStockTradingCalendar：stock-api', async () => {
    await client.getStockTradingCalendar();
    expect(api.calls.getStockTradingCalendar).toHaveBeenCalledTimes(1);
  });
  it('个股资金流 getStockFundsFlowing：stock-sdk > stock-api', async () => {
    await client.getStockFundsFlowing({ code: '600519' });
    expect(sdk.calls.getStockFundsFlowing).toHaveBeenCalledTimes(1);
    expect(api.calls.getStockFundsFlowing).not.toHaveBeenCalled();
  });
  it('热门行业 getStockHotIndustry：stock-api', async () => {
    await client.getStockHotIndustry();
    expect(api.calls.getStockHotIndustry).toHaveBeenCalledTimes(1);
  });
  it('今日涨幅 getStockTodaySurge：stock-api', async () => {
    await client.getStockTodaySurge();
    expect(api.calls.getStockTodaySurge).toHaveBeenCalledTimes(1);
  });
  it('行业板块 getStockIndustryBoard：stock-sdk', async () => {
    await client.getStockIndustryBoard();
    expect(sdk.calls.getStockIndustryBoard).toHaveBeenCalledTimes(1);
  });
  it('行业资金流 getStockIndustryFundsFlowing：stock-sdk', async () => {
    await client.getStockIndustryFundsFlowing();
    expect(sdk.calls.getStockIndustryFundsFlowing).toHaveBeenCalledTimes(1);
  });

  it('全部失败：聚合错误', async () => {
    const fail = (id: string) => makeMockSource(id, { supported: CAPABILITY[id as keyof typeof CAPABILITY], failAlways: true }).source;
    const c = buildClient({ hithsa: fail('hithsa'), 'stock-sdk': fail('stock-sdk'), 'stock-api': fail('stock-api'), 'fund-api': fail('fund-api') });
    await expect(c.getKline({ symbol: A, period: 'month' })).rejects.toThrow(/all data sources failed/);
  });

  it('无源注册：工厂抛错', async () => {
    const c = buildClient({});
    await expect(c.getFundList()).rejects.toThrow(/no source fund-api/);
  });
});

describe('MarketDataClient —— 同花顺(hithsa) 专属深度能力透传', () => {
  let client: MarketDataClient;
  let hithsa: ReturnType<typeof makeMockSource>;
  /** 仅暴露 hithsa 部分能力，其余用宽松 mock 兜底，专注验证 hithsa 透传 */
  const hithsaMethods = [
    'getAdjustmentFactors', 'getValuations', 'getIncomeStatements', 'getBalanceSheets', 'getCashFlowStatements',
    'getFinancialIndicators', 'listIndices', 'getIndexConstituents', 'getFundProfile', 'getFundHoldings',
    'getFundNav', 'getFundReturns', 'getFundHolders', 'getFundMarketSnapshot', 'getFundHistorical', 'getLimitUpPool',
    'getLimitUpLadder', 'getAnomalyList', 'getAnomalyByStocks', 'getSkyrocketList', 'getHotStockList',
    'getHotStockListHistory', 'getHotStockRankTrend', 'getDragonTigerList', 'getTradingDays',
  ];

  beforeEach(() => {
    setApiConfig({ ...defaultApiConfig });
    hithsa = makeMockSource('hithsa', { supported: hithsaMethods });
    client = buildClient({ hithsa: hithsa.source });
  });

  it('财务三表 / 指标全部透传 hithsa', async () => {
    await client.getIncomeStatements({ symbol: A, period: 'quarterly' } as any);
    await client.getBalanceSheets({ symbol: A, period: 'annual' } as any);
    await client.getCashFlowStatements({ symbol: A, period: 'annual' } as any);
    await client.getFinancialIndicators({ symbol: A, report: '2023' } as any);
    expect(hithsa.calls.getIncomeStatements).toHaveBeenCalledTimes(1);
    expect(hithsa.calls.getBalanceSheets).toHaveBeenCalledTimes(1);
    expect(hithsa.calls.getCashFlowStatements).toHaveBeenCalledTimes(1);
    expect(hithsa.calls.getFinancialIndicators).toHaveBeenCalledTimes(1);
  });

  it('估值 / 复权因子透传 hithsa', async () => {
    await client.getValuations([A]);
    await client.getAdjustmentFactors(A);
    expect(hithsa.calls.getValuations).toHaveBeenCalledTimes(1);
    expect(hithsa.calls.getAdjustmentFactors).toHaveBeenCalledTimes(1);
  });

  it('指数列表 / 成分透传 hithsa', async () => {
    await client.listIndices('main' as any);
    await client.getIndexConstituents(A);
    expect(hithsa.calls.listIndices).toHaveBeenCalledTimes(1);
    expect(hithsa.calls.getIndexConstituents).toHaveBeenCalledTimes(1);
  });

  it('基金档案 / 持仓 / 净值 / 收益 / 持有人透传 hithsa', async () => {
    await client.getFundProfile(A, 'ALL' as any);
    await client.getFundHoldings(A, 'ALL' as any);
    await client.getFundNav(A, 'ALL' as any, '1y');
    await client.getFundReturns(A, 'ALL' as any);
    await client.getFundHolders(A, 'ALL' as any, 'merged');
    expect(hithsa.calls.getFundProfile).toHaveBeenCalledTimes(1);
    expect(hithsa.calls.getFundHoldings).toHaveBeenCalledTimes(1);
    expect(hithsa.calls.getFundNav).toHaveBeenCalledTimes(1);
    expect(hithsa.calls.getFundReturns).toHaveBeenCalledTimes(1);
    expect(hithsa.calls.getFundHolders).toHaveBeenCalledTimes(1);
  });

  it('涨停池 / 异动 / 飙升 / 热度 / 龙虎榜 / 交易日历透传 hithsa', async () => {
    await client.getLimitUpPool({ dateMs: Date.now() });
    await client.getAnomalyList(['tag1']);
    await client.getSkyrocketList('day');
    await client.getHotStockList('day');
    await client.getDragonTigerList({ boardType: 'STIB' });
    await client.getTradingDays();
    expect(hithsa.calls.getLimitUpPool).toHaveBeenCalledTimes(1);
    expect(hithsa.calls.getAnomalyList).toHaveBeenCalledTimes(1);
    expect(hithsa.calls.getSkyrocketList).toHaveBeenCalledTimes(1);
    expect(hithsa.calls.getHotStockList).toHaveBeenCalledTimes(1);
    expect(hithsa.calls.getDragonTigerList).toHaveBeenCalledTimes(1);
    expect(hithsa.calls.getTradingDays).toHaveBeenCalledTimes(1);
  });

  it('未注册 hithsa 时透传方法抛错', async () => {
    const c = buildClient({});
    await expect(c.getTradingDays()).rejects.toThrow(/no source hithsa/);
  });
});
