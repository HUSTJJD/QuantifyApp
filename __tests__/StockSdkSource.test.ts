/**
 * StockSdkSource 单元测试
 *
 * 覆盖目标：对 stock-sdk v2.4.1 全部能力的封装是否完整、映射正确、失败可重试、不支持能力 3004 fallback。
 *  - MarketDataSource 接口方法：search / listTickers / getQuotes / getOrderBook / getKline（日周月 + 分钟）
 *    / getAdjustmentFactors / getValuations / 三表与财务指标（均 3004）/ listIndices / getIndexConstituents
 *    / getIndexQuotes / getIndexKline / 基金全系 / 涨停池 / 连板天梯 / 盘口异动 / 飙升榜 / 热股榜（资金流近似）
 *    / 热股历史与排名趋势（3004）/ 龙虎榜 / 交易日历
 *  - SDK 专属扩展方法：港股/美股/基金/批量行情、港股/美股 K 线、分钟级 K 线（cn/hk/us）、当日分时
 *    （仅 A 股，港股/美股 3004）、逐笔（3004）、港股/美股盘口（空）、市场概览、板块行情/成分、
 *    resolveSymbol、addIndicators、calcChipDistribution、calcSignals、screen/backtest（3004）、
 *    资金流（个股/大盘/排行/板块排行）、北向（分时/汇总/持股排行/历史）、盘口异动、板块异动、
 *    龙虎榜（个股统计/机构/营业部/席位）、大宗交易、两融、基金（分红/排名/主题）、概念板块、
 *    行业板块行情、交易日判断/下一/上一交易日、市场状态、全量代码表/行情、清缓存
 *  - 契约：失败必须抛可被上层识别的 DataSourceError（非 3004 视为可重试）；列表类方法空输入返回 []。
 *
 * 通过 jest.mock('stock-sdk') 注入一个实现全部真实命名空间与方法的假 SDK，精确断言调用参数与返回映射。
 */
import { StockSdkSource } from '@/api/sources/StockSdkSource';
import { DataSourceError } from '@/api/MarketDataSource';
import { isValidCandle } from '@/api/candleValidity';
import type { Symbol } from '@/api';

// ---------------- mock stock-sdk（真实 API 结构） ----------------
const mockSdk = {
  quotes: {
    cn: jest.fn(),
    hk: jest.fn(),
    us: jest.fn(),
    fund: jest.fn(),
    cnSimple: jest.fn(),
    largeOrder: jest.fn(),
    timeline: jest.fn(),
  },
  kline: {
    cn: jest.fn(),
    hk: jest.fn(),
    us: jest.fn(),
    cnMinute: jest.fn(),
    hkMinute: jest.fn(),
    usMinute: jest.fn(),
    withIndicators: jest.fn(),
    signals: jest.fn(),
  },
  chips: { cn: jest.fn(), hk: jest.fn(), us: jest.fn() },
  batch: { cn: jest.fn(), hk: jest.fn(), us: jest.fn(), byCodes: jest.fn() },
  codes: { cn: jest.fn(), hk: jest.fn(), us: jest.fn(), fund: jest.fn() },
  board: {
    industry: { list: jest.fn(), constituents: jest.fn(), spot: jest.fn(), kline: jest.fn(), minuteKline: jest.fn() },
    concept: { list: jest.fn(), constituents: jest.fn(), spot: jest.fn(), kline: jest.fn(), minuteKline: jest.fn() },
  },
  fundFlow: {
    individual: jest.fn(),
    market: jest.fn(),
    rank: jest.fn(),
    sectorRank: jest.fn(),
    sectorHistory: jest.fn(),
  },
  northbound: {
    minute: jest.fn(),
    summary: jest.fn(),
    holdingRank: jest.fn(),
    history: jest.fn(),
    individual: jest.fn(),
  },
  marketEvent: {
    ztPool: jest.fn(),
    stockChanges: jest.fn(),
    boardChanges: jest.fn(),
    individualChanges: jest.fn(),
    individualChangesHistory: jest.fn(),
  },
  dragonTiger: {
    detail: jest.fn(),
    stockStats: jest.fn(),
    institution: jest.fn(),
    branchRank: jest.fn(),
    seatDetail: jest.fn(),
  },
  blockTrade: { marketStat: jest.fn(), detail: jest.fn(), dailyStat: jest.fn() },
  margin: { accountInfo: jest.fn(), targetList: jest.fn() },
  fund: {
    dividendList: jest.fn(),
    navHistory: jest.fn(),
    rankHistory: jest.fn(),
    profile: jest.fn(),
    theme: { getThemeList: jest.fn() },
  },
  calendar: {
    isTradingDay: jest.fn(),
    nextTradingDay: jest.fn(),
    prevTradingDay: jest.fn(),
    marketStatus: jest.fn(() => 'closed'),
  },
  reference: { dividendDetail: jest.fn(), tradingCalendar: jest.fn() },
  options: {
    index: { spot: jest.fn(), kline: jest.fn() },
    etf: { months: jest.fn(), expireDay: jest.fn(), minute: jest.fn(), dailyKline: jest.fn(), fiveDayMinute: jest.fn() },
    commodity: { spot: jest.fn(), kline: jest.fn() },
    cffex: { quotes: jest.fn() },
    lhb: jest.fn(),
  },
  futures: {
    kline: jest.fn(),
    globalKline: jest.fn(),
    inventorySymbols: jest.fn(),
    inventory: jest.fn(),
    comexInventory: jest.fn(),
  },
  search: jest.fn(),
  clearCaches: jest.fn(),
};

jest.mock('stock-sdk', () => ({
  StockSDK: class {
    quotes = mockSdk.quotes;
    kline = mockSdk.kline;
    chips = mockSdk.chips;
    batch = mockSdk.batch;
    codes = mockSdk.codes;
    board = mockSdk.board;
    fundFlow = mockSdk.fundFlow;
    northbound = mockSdk.northbound;
    marketEvent = mockSdk.marketEvent;
    dragonTiger = mockSdk.dragonTiger;
    blockTrade = mockSdk.blockTrade;
    margin = mockSdk.margin;
    fund = mockSdk.fund;
    calendar = mockSdk.calendar;
    reference = mockSdk.reference;
    options = mockSdk.options;
    futures = mockSdk.futures;
    search = mockSdk.search;
    clearCaches = mockSdk.clearCaches;
  },
}));

// ---- helpers ----
const CN = (code: string): Symbol => ({ code, exchange: 'SH' });
const HK = (code: string): Symbol => ({ code, exchange: 'HK' });
const US = (code: string): Symbol => ({ code, exchange: 'US' });
const FUND = (code: string): Symbol => ({ code, exchange: 'OF' });

const FULL = (code: string) => ({
  code,
  name: `名称${code}`,
  price: 10.5,
  prevClose: 10,
  open: 10.1,
  high: 11,
  low: 9.9,
  volume: 1000,
  amount: 10500,
  change: 0.5,
  changePercent: 5,
  amplitude: 2,
  timestamp: 1700000000000,
  bid: [
    { price: 10.4, volume: 100 },
    { price: 10.3, volume: 200 },
  ],
  ask: [
    { price: 10.6, volume: 150 },
    { price: 10.7, volume: 250 },
  ],
  pe: 30,
  peStatic: 28,
  pb: 9,
  psTtm: 12,
  pcfTtm: 5,
});

const HKQ = (code: string) => ({
  code,
  name: `港股${code}`,
  price: 400,
  prevClose: 390,
  open: 395,
  high: 405,
  low: 388,
  volume: 500,
  amount: 200000,
  change: 10,
  changePercent: 2.5,
  amplitude: 4,
  timestamp: 1700000000000,
});
const USQ = (code: string) => ({
  code,
  name: `美股${code}`,
  price: 190,
  prevClose: 188,
  open: 189,
  high: 191,
  low: 187,
  volume: 10,
  amount: 1900,
  change: 2,
  changePercent: 1.06,
  amplitude: 2,
  timestamp: 1700000000000,
});
const FUNDQ = (code: string) => ({
  code,
  name: `基金${code}`,
  nav: 3.5,
  accNav: 4.2,
  change: 0.1,
  timestamp: 1700000000000,
});

beforeEach(() => jest.clearAllMocks());

describe('单例与注册', () => {
  it('getInstance 返回同一实例', () => {
    expect(StockSdkSource.getInstance()).toBe(StockSdkSource.getInstance());
  });
  it('id / label 固定', () => {
    const s = new StockSdkSource();
    expect(s.id).toBe('stock-sdk');
    expect(s.label).toBe('StockSDK');
  });
});

describe('search（标的检索）', () => {
  it('空关键词返回空数组', async () => {
    const s = new StockSdkSource();
    expect(await s.search({ keyword: '   ' })).toEqual([]);
  });
  it('委托 sdk.search 并映射 Instrument', async () => {
    mockSdk.search.mockResolvedValue([{ code: '600519', market: 'CN', name: '贵州茅台', type: 'a-share' }]);
    const s = new StockSdkSource();
    const res = await s.search({ keyword: '茅台', limit: 10 });
    expect(mockSdk.search).toHaveBeenCalledWith('茅台');
    expect(res[0]).toMatchObject({ symbol: { code: '600519', exchange: 'SH', name: '贵州茅台' }, market: 'A', assetType: 'a-share' });
    expect(res).toHaveLength(1);
  });
  it('limit 截断', async () => {
    mockSdk.search.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ code: `60000${i}`, market: 'CN', name: `X${i}`, type: 'a-share' })));
    const s = new StockSdkSource();
    const res = await s.search({ keyword: 'x', limit: 2 });
    expect(res).toHaveLength(2);
  });
  it('失败时抛 DataSourceError（可重试）', async () => {
    mockSdk.search.mockRejectedValue(new Error('net'));
    const s = new StockSdkSource();
    await expect(s.search({ keyword: 'x' })).rejects.toBeInstanceOf(DataSourceError);
  });
});

describe('listTickers（A股代码表）', () => {
  it('委托 sdk.codes.cn', async () => {
    mockSdk.codes.cn.mockResolvedValue(['600519', '000001']);
    const s = new StockSdkSource();
    const res = await s.listTickers();
    expect(mockSdk.codes.cn).toHaveBeenCalled();
    expect(res[0].symbol).toMatchObject({ code: '600519', exchange: 'SH' });
    expect(res[1].symbol.exchange).toBe('SZ');
  });
});

describe('getQuotes（跨市场批量行情）', () => {
  it('A股走 quotes.cn；港股走 quotes.hk；美股走 quotes.us；基金走 quotes.fund', async () => {
    mockSdk.quotes.cn.mockResolvedValue([FULL('600519')]);
    mockSdk.quotes.hk.mockResolvedValue([HKQ('00700')]);
    mockSdk.quotes.us.mockResolvedValue([USQ('AAPL')]);
    mockSdk.quotes.fund.mockResolvedValue([FUNDQ('110011')]);
    const s = new StockSdkSource();
    const res = await s.getQuotes([CN('600519'), HK('00700'), US('AAPL'), FUND('110011')]);
    expect(mockSdk.quotes.cn).toHaveBeenCalledWith(['600519']);
    expect(mockSdk.quotes.hk).toHaveBeenCalledWith(['00700']);
    expect(mockSdk.quotes.us).toHaveBeenCalledWith(['AAPL']);
    expect(mockSdk.quotes.fund).toHaveBeenCalledWith(['110011']);
    expect(res).toHaveLength(4);
    expect(res[0].last).toBe(10.5);
    expect(res[1].last).toBe(400);
    expect(res[2].last).toBe(190);
    expect(res[3].last).toBe(3.5);
  });
  it('空输入返回空数组', async () => {
    const s = new StockSdkSource();
    expect(await s.getQuotes([])).toEqual([]);
  });
  it('缺失代码不抛错，返回 0 兜底', async () => {
    mockSdk.quotes.cn.mockResolvedValue([{ code: '600519' }]);
    const s = new StockSdkSource();
    const res = await s.getQuotes([CN('600519')]);
    expect(res[0].last).toBe(0);
    expect(res[0].updatedAt).toBeDefined();
  });
});

describe('getOrderBook（五档盘口）', () => {
  it('A股由 quotes.cn 的 bid/ask 解析', async () => {
    mockSdk.quotes.cn.mockResolvedValue([FULL('600519')]);
    const s = new StockSdkSource();
    const ob = await s.getOrderBook(CN('600519'));
    expect(ob.bids).toEqual([{ price: 10.4, volume: 100 }, { price: 10.3, volume: 200 }]);
    expect(ob.asks).toHaveLength(2);
  });
  it('港股/美股/基金返回空盘口（本 SDK 版本无盘口字段）', async () => {
    const s = new StockSdkSource();
    expect((await s.getOrderBook(HK('00700'))).bids).toEqual([]);
    expect((await s.getOrderBook(US('AAPL'))).asks).toEqual([]);
    expect((await s.getOrderBook(FUND('110011'))).bids).toEqual([]);
  });
});

describe('getKline（历史K线）', () => {
  const K = (date: string) => ({ date, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1000, amount: 1500 });
  it('日线走 kline.cn daily', async () => {
    mockSdk.kline.cn.mockResolvedValue([K('2024-01-01'), K('2024-01-02')]);
    const s = new StockSdkSource();
    const res = await s.getKline({ symbol: CN('600519'), period: 'day' });
    expect(mockSdk.kline.cn).toHaveBeenCalledWith('600519', { period: 'daily', adjust: '' });
    expect(res[1].close).toBe(1.5);
  });
  it('周线/月线映射 weekly/monthly，支持复权与起止', async () => {
    mockSdk.kline.cn.mockResolvedValue([K('2024-01-01')]);
    const s = new StockSdkSource();
    await s.getKline({ symbol: CN('600519'), period: 'week', adjust: 'forward' });
    expect(mockSdk.kline.cn).toHaveBeenCalledWith('600519', { period: 'weekly', adjust: 'qfq' });
    await s.getKline({ symbol: CN('600519'), period: 'month', adjust: 'backward', startMs: 1700000000000, endMs: 1700100000000 });
    expect(mockSdk.kline.cn).toHaveBeenCalledWith('600519', {
      period: 'monthly',
      adjust: 'hfq',
      startDate: expect.any(String),
      endDate: expect.any(String),
    });
  });
  it('港股/美股走 kline.hk/us', async () => {
    mockSdk.kline.hk.mockResolvedValue([K('2024-01-01')]);
    mockSdk.kline.us.mockResolvedValue([K('2024-01-01')]);
    const s = new StockSdkSource();
    await s.getKline({ symbol: HK('00700'), period: 'day' });
    expect(mockSdk.kline.hk).toHaveBeenCalledWith('00700', { period: 'daily', adjust: '' });
    await s.getKline({ symbol: US('AAPL'), period: 'day' });
    expect(mockSdk.kline.us).toHaveBeenCalledWith('AAPL', { period: 'daily', adjust: '' });
  });
  it('分钟级（1m/5m）走 kline.cnMinute 等', async () => {
    mockSdk.kline.cnMinute.mockResolvedValue([{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100, amount: 150 }]);
    mockSdk.kline.hkMinute.mockResolvedValue([{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }]);
    mockSdk.kline.usMinute.mockResolvedValue([{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }]);
    const s = new StockSdkSource();
    await s.getKline({ symbol: CN('600519'), period: '1m' });
    expect(mockSdk.kline.cnMinute).toHaveBeenCalledWith('600519', { period: '1', adjust: '', startDate: undefined, endDate: undefined });
    await s.getKline({ symbol: HK('00700'), period: '5m' });
    expect(mockSdk.kline.hkMinute).toHaveBeenCalledWith('00700', { period: '5', adjust: '', startDate: undefined, endDate: undefined });
    await s.getKline({ symbol: US('AAPL'), period: '15m' });
    expect(mockSdk.kline.usMinute).toHaveBeenCalledWith('AAPL', { period: '15', adjust: '', startDate: undefined, endDate: undefined });
  });
});

describe('getAdjustmentFactors（复权因子）', () => {
  it('委托 reference.dividendDetail 并按 from/to 过滤', async () => {
    mockSdk.reference.dividendDetail.mockResolvedValue([
      { code: '600519', date: '2023-06-01', dividend: 2, bonus: 0 },
      { code: '600519', date: '2024-06-01', dividend: 3, bonus: 1 },
    ]);
    const s = new StockSdkSource();
    const res = await s.getAdjustmentFactors(CN('600519'), '2024-01-01', '2024-12-31');
    expect(mockSdk.reference.dividendDetail).toHaveBeenCalledWith('600519');
    expect(res).toHaveLength(1);
    expect(res[0].exDateMs).toBe(new Date('2024-06-01').getTime());
    expect(res[0].dividendPerShare).toBe(3);
    expect(res[0].perShareBonus).toBe(1);
  });
});

describe('getValuations（估值）', () => {
  it('A股从 quotes.cn 映射估值字段', async () => {
    mockSdk.quotes.cn.mockResolvedValue([FULL('600519')]);
    const s = new StockSdkSource();
    const res = await s.getValuations([CN('600519')]);
    expect(mockSdk.quotes.cn).toHaveBeenCalledWith(['600519']);
    expect(res[0]).toMatchObject({ peTtm: 30, peMrq: 28, pbMrq: 9, psTtm: 12, pcfTtm: 5 });
  });
  it('港股/美股无估值字段返回 null', async () => {
    const s = new StockSdkSource();
    const res = await s.getValuations([HK('00700')]);
    expect(res[0]).toMatchObject({ peTtm: null, pbMrq: null });
  });
  it('空输入返回空', async () => {
    const s = new StockSdkSource();
    expect(await s.getValuations([])).toEqual([]);
  });
});

describe('财务报表（SDK 未支持 -> 3004）', () => {
  it.each(['getIncomeStatements', 'getBalanceSheets', 'getCashFlowStatements', 'getFinancialIndicators'])(
    '%s 抛 3004',
    async (m) => {
      const s = new StockSdkSource();
      await expect((s as any)[m]({ symbol: CN('600519'), period: 'quarterly' })).rejects.toMatchObject({
        sourceId: 'stock-sdk',
        upstreamCode: 3004,
      });
    },
  );
});

describe('指数 / 板块', () => {
  it('listIndices 委托 board.industry.list', async () => {
    mockSdk.board.industry.list.mockResolvedValue([{ code: 'BK0001', name: '银行' }]);
    const s = new StockSdkSource();
    const res = await s.listIndices();
    expect(mockSdk.board.industry.list).toHaveBeenCalled();
    expect(res[0].symbol).toMatchObject({ code: 'BK0001', exchange: 'SH', name: '银行' });
  });
  it('getIndexConstituents 委托 board.industry.constituents', async () => {
    mockSdk.board.industry.constituents.mockResolvedValue([{ code: '600519', name: '茅台' }]);
    const s = new StockSdkSource();
    const res = await s.getIndexConstituents(CN('BK0001'));
    expect(mockSdk.board.industry.constituents).toHaveBeenCalledWith('BK0001');
    expect(res[0].symbol.code).toBe('600519');
  });
  it('getIndexQuotes 委托 batch.byCodes', async () => {
    mockSdk.batch.byCodes.mockResolvedValue([FULL('000001')]);
    const s = new StockSdkSource();
    const res = await s.getIndexQuotes([CN('000001')]);
    expect(mockSdk.batch.byCodes).toHaveBeenCalledWith(['000001']);
    expect(res[0].last).toBe(10.5);
  });
  it('getIndexKline 委托 kline.cn', async () => {
    mockSdk.kline.cn.mockResolvedValue([{ date: '2024-01-01', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }]);
    const s = new StockSdkSource();
    await s.getIndexKline({ symbol: CN('000001'), period: 'day' });
    expect(mockSdk.kline.cn).toHaveBeenCalled();
  });
  it('getBoardQuotes 委托 board.industry.spot', async () => {
    mockSdk.board.industry.spot.mockResolvedValue([{ code: 'BK0001', name: '银行', price: 1200, high: 1250, low: 1180, volume: 1e8, amount: 1e10, changePercent: 1.2, change: 15, timestamp: 1700000000000 }]);
    const s = new StockSdkSource();
    const res = await s.getBoardQuotes([CN('BK0001')]);
    expect(mockSdk.board.industry.spot).toHaveBeenCalledWith('BK0001');
    expect(res[0].last).toBe(1200);
    expect(res[0].changePct).toBe(1.2);
  });
});

describe('基金全系', () => {
  const PROFILE = {
    code: '110011',
    name: '易方达中小盘',
    estabDate: '2008-06-19',
    managers: [{ name: '张坤' }],
    holdings: [{ code: '600519', name: '茅台', holdRatioFloat: 9.8 }],
    stageReturns: { oneMonth: 1.2, threeMonth: 3.4, sixMonth: 5.6, oneYear: 15.3 },
    holderStructure: [{ timestamp: new Date('2024-03-31').getTime(), institutionRatio: 60, individualRatio: 40, internalRatio: 0.1 }],
    dividendList: [],
    latestNav: { date: '2024-01-02', nav: 3.5, accNav: 4.2 },
    navHistory: [{ date: '2024-01-02', nav: 3.5, accNav: 4.2 }],
  };
  beforeEach(() => {
    mockSdk.fund.profile.mockResolvedValue(PROFILE);
    mockSdk.fund.navHistory.mockResolvedValue({ items: [{ date: '2024-01-02', nav: 3.5, accNav: 4.2 }] });
    mockSdk.quotes.fund.mockResolvedValue([FUNDQ('110011')]);
  });
  it('getFundProfile', async () => {
    const s = new StockSdkSource();
    const r = await s.getFundProfile(FUND('110011'), 'exchange');
    expect(r.fundName).toBe('易方达中小盘');
    expect(r.estabDateMs).toBe(new Date('2008-06-19').getTime());
    expect(r.managerName).toBe('张坤');
  });
  it('getFundHoldings', async () => {
    const s = new StockSdkSource();
    const r = await s.getFundHoldings(FUND('110011'), 'exchange');
    expect(r[0].holdRatio).toBe(9.8);
  });
  it('getFundNav', async () => {
    const s = new StockSdkSource();
    const r = await s.getFundNav(FUND('110011'), 'exchange');
    expect(r[0].unitNav).toBe(3.5);
    expect(r[0].adjNav).toBe(4.2);
  });
  it('getFundReturns', async () => {
    const s = new StockSdkSource();
    const r = await s.getFundReturns(FUND('110011'), 'exchange');
    expect(r.returnMonth).toBe(1.2);
    expect(r.returnYear).toBe(15.3);
  });
  it('getFundHolders', async () => {
    const s = new StockSdkSource();
    const r = await s.getFundHolders(FUND('110011'), 'exchange');
    expect(r[0].insPosition).toBe(60);
    expect(r[0].psnlRate).toBe(40);
  });
  it('getFundMarketSnapshot 委托 quotes.fund', async () => {
    const s = new StockSdkSource();
    const r = await s.getFundMarketSnapshot(FUND('110011'));
    expect(mockSdk.quotes.fund).toHaveBeenCalledWith(['110011']);
    expect(r.last).toBe(3.5);
  });
  it('getFundHistorical 委托 navHistory', async () => {
    const s = new StockSdkSource();
    const r = await s.getFundHistorical(FUND('110011'), 0, 0);
    expect(mockSdk.fund.navHistory).toHaveBeenCalledWith('110011');
    expect(r[0].close).toBe(3.5);
  });
});

describe('特色数据', () => {
  it('getLimitUpPool 委托 marketEvent.ztPool', async () => {
    mockSdk.marketEvent.ztPool.mockResolvedValue([
      { code: '600519', name: '贵州茅台', price: 1800, changePercent: 10, firstBoardTime: '09:30', industry: '白酒', continuousBoardCount: 2, boardAmount: 1000 },
    ]);
    const s = new StockSdkSource();
    const r = await s.getLimitUpPool({ dateMs: 1700000000000 });
    expect(mockSdk.marketEvent.ztPool).toHaveBeenCalledWith('zt', expect.any(String));
    expect(r.items[0].continueDayCnt).toBe(2);
    expect(r.items[0].limitUpTime).toBe('09:30');
  });
  it('getLimitUpLadder 复用涨停池并按连板数排序', async () => {
    mockSdk.marketEvent.ztPool.mockResolvedValue([
      { code: 'A', name: 'A', continuousBoardCount: 1 },
      { code: 'B', name: 'B', continuousBoardCount: 5 },
    ]);
    const s = new StockSdkSource();
    const r = (await s.getLimitUpLadder()) as any[];
    expect(r[0].symbol.code).toBe('B');
  });
  it('getAnomalyList 委托 marketEvent.stockChanges("all")', async () => {
    mockSdk.marketEvent.stockChanges.mockResolvedValue([{ code: '600519', name: '茅台', info: '放量', changeTypeLabel: '放量' }]);
    const s = new StockSdkSource();
    const r = await s.getAnomalyList();
    expect(mockSdk.marketEvent.stockChanges).toHaveBeenCalledWith('all');
    expect(r[0].analysisContent).toBe('放量');
  });
  it('getSkyrocketList 委托 stockChanges("rocket_launch")', async () => {
    mockSdk.marketEvent.stockChanges.mockResolvedValue([{ code: '600519', name: '茅台', heat: 99, rank: 1 }]);
    const s = new StockSdkSource();
    const r = await s.getSkyrocketList();
    expect(mockSdk.marketEvent.stockChanges).toHaveBeenCalledWith('rocket_launch');
    expect(r[0].heat).toBe(99);
  });
  it('getHotStockList 委托 fundFlow.rank（资金流近似）', async () => {
    mockSdk.fundFlow.rank.mockResolvedValue([{ code: '600519', name: '茅台', mainNetInflow: 5000 }]);
    const s = new StockSdkSource();
    const r = await s.getHotStockList();
    expect(mockSdk.fundFlow.rank).toHaveBeenCalledWith({ indicator: 'today' });
    expect(r[0].heat).toBe(5000);
  });
  it('getHotStockListHistory / getHotStockRankTrend 抛 3004', async () => {
    const s = new StockSdkSource();
    await expect(s.getHotStockListHistory('2024-01-02')).rejects.toMatchObject({ upstreamCode: 3004 });
    await expect(s.getHotStockRankTrend(CN('600519'), '2024-01-01', '2024-01-02')).rejects.toMatchObject({ upstreamCode: 3004 });
  });
  it('getDragonTigerList 委托 dragonTiger.detail', async () => {
    mockSdk.dragonTiger.detail.mockResolvedValue([{ code: '600519', name: '茅台', changePercent: 10, buyAmount: 1000, sellAmount: 500, netBuyAmount: 500, netBuyRatio: 0.2, reason: '机构买入' }]);
    const s = new StockSdkSource();
    const r = await s.getDragonTigerList({ date: '2024-01-02' });
    expect(mockSdk.dragonTiger.detail).toHaveBeenCalledWith({ startDate: '20240102', endDate: '20240102' });
    expect(r.stockItems[0].netValue).toBe(500);
    expect(r.stockItems[0].limitReason).toBe('机构买入');
  });
});

describe('交易日历', () => {
  it('getTradingDays 委托 reference.tradingCalendar', async () => {
    mockSdk.reference.tradingCalendar.mockResolvedValue(['2024-01-02', '2024-01-03']);
    const s = new StockSdkSource();
    const r = await s.getTradingDays();
    expect(r[0].date).toBe('2024-01-02');
    expect(r[0].dateMs).toBe(new Date('2024-01-02').getTime());
  });
});

describe('SDK 专属扩展能力', () => {
  it('getQuotesHK / getQuotesUS / getFundQuotes / getQuotesBatch 路由', async () => {
    mockSdk.quotes.hk.mockResolvedValue([HKQ('00700')]);
    mockSdk.quotes.us.mockResolvedValue([USQ('AAPL')]);
    mockSdk.quotes.fund.mockResolvedValue([FUNDQ('110011')]);
    const s = new StockSdkSource();
    const hk = await s.getQuotesHK([HK('00700')]);
    const us = await s.getQuotesUS([US('AAPL')]);
    const fund = await s.getFundQuotes([FUND('110011')]);
    const batch = await s.getQuotesBatch([CN('600519'), HK('00700')]);
    expect(hk[0].last).toBe(400);
    expect(us[0].last).toBe(190);
    expect(fund[0].last).toBe(3.5);
    expect(batch).toHaveLength(2);
  });
  it('getKlineHK / getKlineUS 路由', async () => {
    mockSdk.kline.hk.mockResolvedValue([{ date: '2024-01-01', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }]);
    mockSdk.kline.us.mockResolvedValue([{ date: '2024-01-01', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }]);
    const s = new StockSdkSource();
    await s.getKlineHK({ symbol: HK('00700'), period: 'day' });
    expect(mockSdk.kline.hk).toHaveBeenCalledWith('00700', { period: 'daily', adjust: '' });
    await s.getKlineUS({ symbol: US('AAPL'), period: 'week' });
    expect(mockSdk.kline.us).toHaveBeenCalledWith('AAPL', { period: 'weekly', adjust: '' });
  });
  it('getMinuteKlineCN / HK / US', async () => {
    mockSdk.kline.cnMinute.mockResolvedValue([{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100, amount: 150 }]);
    mockSdk.kline.hkMinute.mockResolvedValue([{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }]);
    mockSdk.kline.usMinute.mockResolvedValue([{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }]);
    const s = new StockSdkSource();
    await s.getMinuteKlineCN('600519', { period: '5' });
    await s.getMinuteKlineHK('00700', { period: '15' });
    await s.getMinuteKlineUS('AAPL', { period: '30' });
    expect(mockSdk.kline.cnMinute).toHaveBeenCalledWith('600519', { period: '5', adjust: '', startDate: undefined, endDate: undefined });
    expect(mockSdk.kline.hkMinute).toHaveBeenCalledWith('00700', { period: '15', adjust: '', startDate: undefined, endDate: undefined });
    expect(mockSdk.kline.usMinute).toHaveBeenCalledWith('AAPL', { period: '30', adjust: '', startDate: undefined, endDate: undefined });
  });
  it('getTodayTimelineCN 委托 quotes.timeline；HK/US 抛 3004', async () => {
    mockSdk.quotes.timeline.mockResolvedValue([{ time: 1, price: 10 }]);
    const s = new StockSdkSource();
    await s.getTodayTimelineCN('600519');
    expect(mockSdk.quotes.timeline).toHaveBeenCalledWith('600519');
    await expect(s.getTodayTimelineHK()).rejects.toMatchObject({ upstreamCode: 3004 });
    await expect(s.getTodayTimelineUS()).rejects.toMatchObject({ upstreamCode: 3004 });
  });
  it('getRealTimeTicks 抛 3004（SDK 无逐笔）', async () => {
    const s = new StockSdkSource();
    await expect(s.getRealTimeTicks()).rejects.toMatchObject({ upstreamCode: 3004 });
  });
  it('getOrderBookHK / US 返回空盘口', async () => {
    const s = new StockSdkSource();
    expect((await s.getOrderBookHK(HK('00700'))).bids).toEqual([]);
    expect((await s.getOrderBookUS(US('AAPL'))).asks).toEqual([]);
  });
  it('getMarketOverviewCN 委托 fundFlow.market', async () => {
    mockSdk.fundFlow.market.mockResolvedValue({ mainNetInflow: 100 });
    const s = new StockSdkSource();
    const r = await s.getMarketOverviewCN();
    expect(mockSdk.fundFlow.market).toHaveBeenCalled();
    expect(r.mainNetInflow).toBe(100);
  });
  it('resolveSymbol 委托 search 首个命中', async () => {
    mockSdk.search.mockResolvedValue([{ code: '600519', market: 'CN', name: '贵州茅台', type: 'a-share' }]);
    const s = new StockSdkSource();
    const r = await s.resolveSymbol('茅台');
    expect(mockSdk.search).toHaveBeenCalledWith('茅台');
    expect(r?.symbol.code).toBe('600519');
  });
  it('addIndicators 委托 kline.withIndicators', async () => {
    mockSdk.kline.withIndicators.mockResolvedValue([{ date: '2024-01-01', close: 1, ma: 1 }]);
    const s = new StockSdkSource();
    await s.addIndicators(CN('600519'), { indicators: { ma: { period: 5 } } });
    expect(mockSdk.kline.withIndicators).toHaveBeenCalledWith('600519', { period: 'daily', adjust: '', indicators: { ma: { period: 5 } } });
  });
  it('calcChipDistribution 委托 chips.cn/hk/us', async () => {
    mockSdk.chips.cn.mockResolvedValue([{ price: 10, ratio: 0.2 }]);
    mockSdk.chips.hk.mockResolvedValue([{ price: 400, ratio: 0.3 }]);
    mockSdk.chips.us.mockResolvedValue([{ price: 190, ratio: 0.4 }]);
    const s = new StockSdkSource();
    await s.calcChipDistribution(CN('600519'));
    await s.calcChipDistribution(HK('00700'));
    await s.calcChipDistribution(US('AAPL'));
    expect(mockSdk.chips.cn).toHaveBeenCalledWith('600519', {});
    expect(mockSdk.chips.hk).toHaveBeenCalledWith('00700', {});
    expect(mockSdk.chips.us).toHaveBeenCalledWith('AAPL', {});
  });
  it('calcSignals 委托 kline.signals', async () => {
    mockSdk.kline.signals.mockResolvedValue({ signals: [{ indexId: 'ma', type: 'gold' }] });
    const s = new StockSdkSource();
    await s.calcSignals(CN('600519'), { maFast: 5, maSlow: 10 });
    expect(mockSdk.kline.signals).toHaveBeenCalledWith('600519', { period: 'daily', adjust: '', maFast: 5, maSlow: 10 });
  });
  it('screen / backtest 抛 3004（SDK 无此能力）', async () => {
    const s = new StockSdkSource();
    await expect(s.screen()).rejects.toMatchObject({ upstreamCode: 3004 });
    await expect(s.backtest()).rejects.toMatchObject({ upstreamCode: 3004 });
  });
  it('资金流：个股 / 大盘 / 排行 / 板块排行', async () => {
    mockSdk.fundFlow.individual.mockResolvedValue([{ date: '2024-01-02', mainNetInflow: 100 }]);
    mockSdk.fundFlow.market.mockResolvedValue({ mainNetInflow: 200 });
    mockSdk.fundFlow.rank.mockResolvedValue([{ code: '600519' }]);
    mockSdk.fundFlow.sectorRank.mockResolvedValue([{ name: '银行' }]);
    const s = new StockSdkSource();
    await s.getStockFundFlow(CN('600519'));
    await s.getMarketFundFlow();
    await s.getFundFlowRank({ indicator: '3day' });
    await s.getSectorFundFlowRank();
    expect(mockSdk.fundFlow.individual).toHaveBeenCalledWith('600519', { period: 'daily' });
    expect(mockSdk.fundFlow.market).toHaveBeenCalled();
    expect(mockSdk.fundFlow.rank).toHaveBeenCalledWith({ indicator: '3day' });
    expect(mockSdk.fundFlow.sectorRank).toHaveBeenCalledWith({ indicator: 'today', sectorType: undefined });
  });
  it('北向：分时 / 汇总 / 持股排行 / 历史', async () => {
    mockSdk.northbound.minute.mockResolvedValue({});
    mockSdk.northbound.summary.mockResolvedValue({});
    mockSdk.northbound.holdingRank.mockResolvedValue([]);
    mockSdk.northbound.history.mockResolvedValue([]);
    const s = new StockSdkSource();
    await s.getNorthboundMinute('north');
    await s.getNorthboundSummary();
    await s.getNorthboundHoldingRank({ market: 'shanghai' });
    await s.getNorthboundHistory('north', { startDate: '2024-01-01', endDate: '2024-01-31' });
    expect(mockSdk.northbound.minute).toHaveBeenCalledWith('north');
    expect(mockSdk.northbound.holdingRank).toHaveBeenCalledWith({ market: 'shanghai', period: undefined, date: undefined });
    expect(mockSdk.northbound.history).toHaveBeenCalledWith('north', { startDate: '2024-01-01', endDate: '2024-01-31' });
  });
  it('盘口异动 / 板块异动 / 个股异动历史', async () => {
    mockSdk.marketEvent.stockChanges.mockResolvedValue([]);
    mockSdk.marketEvent.boardChanges.mockResolvedValue([]);
    mockSdk.marketEvent.individualChangesHistory.mockResolvedValue([]);
    const s = new StockSdkSource();
    await s.getStockChanges(['rocket_launch']);
    await s.getBoardChanges();
    await s.getIndividualChangesHistory(CN('600519'), { days: 7 });
    expect(mockSdk.marketEvent.stockChanges).toHaveBeenCalledWith(['rocket_launch']);
    expect(mockSdk.marketEvent.individualChangesHistory).toHaveBeenCalledWith('600519', { days: 7 });
  });
  it('龙虎榜：个股统计 / 机构 / 营业部 / 席位', async () => {
    mockSdk.dragonTiger.stockStats.mockResolvedValue([]);
    mockSdk.dragonTiger.institution.mockResolvedValue([]);
    mockSdk.dragonTiger.branchRank.mockResolvedValue([]);
    mockSdk.dragonTiger.seatDetail.mockResolvedValue([]);
    const s = new StockSdkSource();
    await s.getDragonTigerStockStats('1month');
    await s.getDragonTigerInstitution({ startDate: '2024-01-01', endDate: '2024-01-31' });
    await s.getDragonTigerBranchRank('6month');
    await s.getDragonTigerSeatDetail(CN('600519'), '20240102');
    expect(mockSdk.dragonTiger.stockStats).toHaveBeenCalledWith('1month');
    expect(mockSdk.dragonTiger.institution).toHaveBeenCalledWith({ startDate: '2024-01-01', endDate: '2024-01-31' });
    expect(mockSdk.dragonTiger.seatDetail).toHaveBeenCalledWith('600519', '20240102');
  });
  it('大宗交易 / 两融 / 基金分红 / 基金排名 / 基金主题', async () => {
    mockSdk.blockTrade.detail.mockResolvedValue([]);
    mockSdk.blockTrade.marketStat.mockResolvedValue({});
    mockSdk.margin.accountInfo.mockResolvedValue({});
    mockSdk.margin.targetList.mockResolvedValue([]);
    mockSdk.fund.dividendList.mockResolvedValue([]);
    mockSdk.fund.rankHistory.mockResolvedValue([]);
    mockSdk.fund.theme.getThemeList.mockResolvedValue([]);
    const s = new StockSdkSource();
    await s.getBlockTradeDetail({ startDate: '2024-01-01', endDate: '2024-01-31' });
    await s.getBlockTradeMarketStat();
    await s.getMarginAccountInfo();
    await s.getMarginTargetList('2024-01-31');
    await s.getFundDividendList({ year: 2024 });
    await s.getFundRankHistory(FUND('110011'));
    await s.getFundThemeList({});
    expect(mockSdk.blockTrade.detail).toHaveBeenCalledWith({ startDate: '2024-01-01', endDate: '2024-01-31' });
    expect(mockSdk.margin.targetList).toHaveBeenCalledWith('2024-01-31');
    expect(mockSdk.fund.dividendList).toHaveBeenCalledWith({ year: 2024, page: undefined, fundType: undefined });
    expect(mockSdk.fund.theme.getThemeList).toHaveBeenCalledWith({});
  });
  it('概念板块 / 行业板块行情', async () => {
    mockSdk.board.concept.list.mockResolvedValue([]);
    mockSdk.board.concept.constituents.mockResolvedValue([]);
    mockSdk.board.industry.spot.mockResolvedValue([]);
    const s = new StockSdkSource();
    await s.getConceptBoardList();
    await s.getConceptBoardConstituents('BK0001');
    await s.getIndustryBoardSpot('BK0001');
    expect(mockSdk.board.concept.list).toHaveBeenCalled();
    expect(mockSdk.board.concept.constituents).toHaveBeenCalledWith('BK0001');
    expect(mockSdk.board.industry.spot).toHaveBeenCalledWith('BK0001');
  });
  it('交易日历工具：isTradingDay / nextTradingDay / prevTradingDay / marketStatus', async () => {
    mockSdk.calendar.isTradingDay.mockResolvedValue(true);
    mockSdk.calendar.nextTradingDay.mockResolvedValue('2024-01-03');
    mockSdk.calendar.prevTradingDay.mockResolvedValue('2024-01-02');
    const s = new StockSdkSource();
    expect(await s.isTradingDay('2024-01-02')).toBe(true);
    expect(await s.nextTradingDay()).toBe('2024-01-03');
    expect(await s.prevTradingDay()).toBe('2024-01-02');
    expect(s.getMarketStatus('HK')).toBe('closed');
  });
  it('全量代码表 / 全量行情 / 清缓存', async () => {
    mockSdk.codes.hk.mockResolvedValue(['00700']);
    mockSdk.batch.us.mockResolvedValue([]);
    const s = new StockSdkSource();
    await s.getCodeList('hk');
    await s.getAllQuotes('us');
    s.clearCaches();
    expect(mockSdk.codes.hk).toHaveBeenCalled();
    expect(mockSdk.batch.us).toHaveBeenCalled();
    expect(mockSdk.clearCaches).toHaveBeenCalled();
  });
});

describe('新增 API：板块 K 线 / 行情补充 / 北向个股 / 个股异动', () => {
  it('getIndustryKline 委托 board.industry.kline', async () => {
    mockSdk.board.industry.kline.mockResolvedValue([{ date: '2024-01-01', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }]);
    const s = new StockSdkSource();
    await s.getIndustryKline('BK0001', { period: 'weekly' });
    expect(mockSdk.board.industry.kline).toHaveBeenCalledWith('BK0001', { period: 'weekly', adjust: undefined, startDate: undefined, endDate: undefined, limit: undefined });
  });
  it('getIndustryMinuteKline 委托 board.industry.minuteKline', async () => {
    mockSdk.board.industry.minuteKline.mockResolvedValue([{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }]);
    const s = new StockSdkSource();
    await s.getIndustryMinuteKline('BK0001', { period: '5' });
    expect(mockSdk.board.industry.minuteKline).toHaveBeenCalledWith('BK0001', { period: '5', adjust: undefined, startDate: undefined, endDate: undefined });
  });
  it('getConceptKline / getConceptMinuteKline 委托 board.concept.*', async () => {
    mockSdk.board.concept.kline.mockResolvedValue([]);
    mockSdk.board.concept.minuteKline.mockResolvedValue([]);
    const s = new StockSdkSource();
    await s.getConceptKline('BK0002', { period: 'daily' });
    await s.getConceptMinuteKline('BK0002', { period: '15' });
    expect(mockSdk.board.concept.kline).toHaveBeenCalledWith('BK0002', { period: 'daily', adjust: undefined, startDate: undefined, endDate: undefined, limit: undefined });
    expect(mockSdk.board.concept.minuteKline).toHaveBeenCalledWith('BK0002', { period: '15', adjust: undefined, startDate: undefined, endDate: undefined });
  });
  it('getQuotesSimpleCN 委托 quotes.cnSimple', async () => {
    mockSdk.quotes.cnSimple.mockResolvedValue([{ code: '600519', name: '茅台', price: 10 }]);
    const s = new StockSdkSource();
    const r = await s.getQuotesSimpleCN(['600519']);
    expect(mockSdk.quotes.cnSimple).toHaveBeenCalledWith(['600519']);
    expect(r[0].code).toBe('600519');
  });
  it('getLargeOrders 委托 quotes.largeOrder', async () => {
    mockSdk.quotes.largeOrder.mockResolvedValue([{ code: '600519', price: 10, volume: 100 }]);
    const s = new StockSdkSource();
    const r = await s.getLargeOrders(['600519']);
    expect(mockSdk.quotes.largeOrder).toHaveBeenCalledWith(['600519']);
    expect(r[0].code).toBe('600519');
  });
  it('getSectorFundFlowHistory 委托 fundFlow.sectorHistory', async () => {
    mockSdk.fundFlow.sectorHistory.mockResolvedValue([{ name: '银行' }]);
    const s = new StockSdkSource();
    await s.getSectorFundFlowHistory('BK0438', { period: 'daily' });
    expect(mockSdk.fundFlow.sectorHistory).toHaveBeenCalledWith('BK0438', { period: 'daily' });
  });
  it('getNorthboundIndividual 委托 northbound.individual', async () => {
    mockSdk.northbound.individual.mockResolvedValue([{ code: '000001', name: '平安' }]);
    const s = new StockSdkSource();
    await s.getNorthboundIndividual('000001', { startDate: '2024-01-01', endDate: '2024-01-31' });
    expect(mockSdk.northbound.individual).toHaveBeenCalledWith('000001', { startDate: '2024-01-01', endDate: '2024-01-31' });
  });
  it('getIndividualChanges 委托 marketEvent.individualChanges', async () => {
    mockSdk.marketEvent.individualChanges.mockResolvedValue([{ code: '600519' }]);
    const s = new StockSdkSource();
    await s.getIndividualChanges('600519', '2024-01-02');
    expect(mockSdk.marketEvent.individualChanges).toHaveBeenCalledWith('600519', { date: '2024-01-02' });
  });
});

describe('新增 API：期权命名空间 options.*', () => {
  it('getOptionIndexSpot 委托 options.index.spot', async () => {
    mockSdk.options.index.spot.mockResolvedValue([{ code: 'IO2408-P-3500', name: 'IO' }]);
    const s = new StockSdkSource();
    const r = await s.getOptionIndexSpot('io', 'IO2408-P-3500');
    expect(mockSdk.options.index.spot).toHaveBeenCalledWith('io', 'IO2408-P-3500');
    expect(r[0].code).toBe('IO2408-P-3500');
  });
  it('getOptionIndexKline 委托 options.index.kline', async () => {
    mockSdk.options.index.kline.mockResolvedValue([{ time: 1, open: 1 }]);
    const s = new StockSdkSource();
    await s.getOptionIndexKline('IO2408-P-3500');
    expect(mockSdk.options.index.kline).toHaveBeenCalledWith('IO2408-P-3500');
  });
  it('getOptionEtfMonths 委托 options.etf.months', async () => {
    mockSdk.options.etf.months.mockResolvedValue(['2024-08', '2024-09']);
    const s = new StockSdkSource();
    await s.getOptionEtfMonths('50ETF');
    expect(mockSdk.options.etf.months).toHaveBeenCalledWith('50ETF');
  });
  it('getOptionEtfExpireDay 委托 options.etf.expireDay', async () => {
    mockSdk.options.etf.expireDay.mockResolvedValue([{ code: '10004336', name: '50ETF购8月' }]);
    const s = new StockSdkSource();
    await s.getOptionEtfExpireDay('50ETF', '2024-08');
    expect(mockSdk.options.etf.expireDay).toHaveBeenCalledWith('50ETF', '2024-08');
  });
  it('getOptionEtfMinuteKline / getOptionEtfDailyKline / getOptionEtfFiveDayMinute', async () => {
    mockSdk.options.etf.minute.mockResolvedValue([]);
    mockSdk.options.etf.dailyKline.mockResolvedValue([]);
    mockSdk.options.etf.fiveDayMinute.mockResolvedValue([]);
    const s = new StockSdkSource();
    await s.getOptionEtfMinuteKline('10004336');
    await s.getOptionEtfDailyKline('10004336');
    await s.getOptionEtfFiveDayMinute('10004336');
    expect(mockSdk.options.etf.minute).toHaveBeenCalledWith('10004336');
    expect(mockSdk.options.etf.dailyKline).toHaveBeenCalledWith('10004336');
    expect(mockSdk.options.etf.fiveDayMinute).toHaveBeenCalledWith('10004336');
  });
  it('getOptionCommoditySpot 委托 options.commodity.spot', async () => {
    mockSdk.options.commodity.spot.mockResolvedValue([{ code: 'CU2408', name: '铜' }]);
    const s = new StockSdkSource();
    await s.getOptionCommoditySpot('CU', 'CU2408');
    expect(mockSdk.options.commodity.spot).toHaveBeenCalledWith('CU', 'CU2408');
  });
  it('getOptionCommodityKline 委托 options.commodity.kline', async () => {
    mockSdk.options.commodity.kline.mockResolvedValue([{ time: 1, open: 1 }]);
    const s = new StockSdkSource();
    await s.getOptionCommodityKline('CU2408');
    expect(mockSdk.options.commodity.kline).toHaveBeenCalledWith('CU2408');
  });
  it('getOptionCffexQuotes 委托 options.cffex.quotes', async () => {
    mockSdk.options.cffex.quotes.mockResolvedValue([{ code: 'T2409', name: '十年国债' }]);
    const s = new StockSdkSource();
    await s.getOptionCffexQuotes({ pageSize: 10 });
    expect(mockSdk.options.cffex.quotes).toHaveBeenCalledWith({ pageSize: 10 });
  });
  it('getOptionLhb 委托 options.lhb', async () => {
    mockSdk.options.lhb.mockResolvedValue([{ code: '10004336', rank: 1 }]);
    const s = new StockSdkSource();
    await s.getOptionLhb('10004336', '2024-08-08');
    expect(mockSdk.options.lhb).toHaveBeenCalledWith('10004336', '2024-08-08');
  });
});

describe('新增 API：期货命名空间 futures.*', () => {
  it('getFuturesKline 委托 futures.kline', async () => {
    mockSdk.futures.kline.mockResolvedValue([{ date: '2024-01-01', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }]);
    const s = new StockSdkSource();
    await s.getFuturesKline('MA0', { period: 'daily', startDate: '20240101', endDate: '20240131' });
    expect(mockSdk.futures.kline).toHaveBeenCalledWith('MA0', { period: 'daily', startDate: '20240101', endDate: '20240131' });
  });
  it('getFuturesGlobalKline 委托 futures.globalKline', async () => {
    mockSdk.futures.globalKline.mockResolvedValue([{ date: '2024-01-01', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }]);
    const s = new StockSdkSource();
    await s.getFuturesGlobalKline('GLNC', { period: 'weekly', marketCode: 1 });
    expect(mockSdk.futures.globalKline).toHaveBeenCalledWith('GLNC', { period: 'weekly', startDate: undefined, endDate: undefined, marketCode: 1 });
  });
  it('getFuturesInventorySymbols 委托 futures.inventorySymbols', async () => {
    mockSdk.futures.inventorySymbols.mockResolvedValue(['CU', 'AL']);
    const s = new StockSdkSource();
    const r = await s.getFuturesInventorySymbols();
    expect(mockSdk.futures.inventorySymbols).toHaveBeenCalled();
    expect(r).toEqual(['CU', 'AL']);
  });
  it('getFuturesInventory 委托 futures.inventory', async () => {
    mockSdk.futures.inventory.mockResolvedValue([{ date: '2024-01-02', value: 100 }]);
    const s = new StockSdkSource();
    await s.getFuturesInventory('CU', { startDate: '2024-01-01', pageSize: 20 });
    expect(mockSdk.futures.inventory).toHaveBeenCalledWith('CU', { startDate: '2024-01-01', pageSize: 20 });
  });
  it('getFuturesComexInventory 委托 futures.comexInventory', async () => {
    mockSdk.futures.comexInventory.mockResolvedValue([{ date: '2024-01-02', value: 100 }]);
    const s = new StockSdkSource();
    await s.getFuturesComexInventory('gold', { pageSize: 20 });
    expect(mockSdk.futures.comexInventory).toHaveBeenCalledWith('gold', { pageSize: 20 });
  });
});

describe('失败统一契约', () => {
  it('任意 SDK 方法失败均抛 DataSourceError（可重试，非 3004）', async () => {
    mockSdk.quotes.cn.mockRejectedValue(new Error('network'));
    const s = new StockSdkSource();
    await expect(s.getQuotes([CN('600519')])).rejects.toMatchObject({ sourceId: 'stock-sdk' });
    await expect(s.getQuotes([CN('600519')])).rejects.not.toMatchObject({ upstreamCode: 3004 });
  });
  it('不掩盖已有的 DataSourceError', async () => {
    mockSdk.quotes.cn.mockRejectedValue(new DataSourceError('inner', 'other', 999));
    const s = new StockSdkSource();
    await expect(s.getQuotes([CN('600519')])).rejects.toMatchObject({ sourceId: 'other', upstreamCode: 999 });
  });
});

// ---------------- 数据有效性（严格） ----------------
describe('StockSdkSource.getKline 数据有效性（严格）', () => {
  it('剔除 NaN/缺失/价格关系异常的脏数据，仅保留合法 K 线', async () => {
    mockSdk.kline.cn.mockResolvedValue([
      { date: '2024-01-01', open: 10, high: 11, low: 9, close: 10.5, volume: 1000, amount: 10500 }, // 合法
      { date: '2024-01-02', open: NaN, high: 11, low: 9, close: 10.5, volume: 1000, amount: 10500 }, // NaN 价格
      { date: '2024-01-03', open: 10, high: 5, low: 9, close: 10.5, volume: 1000, amount: 10500 }, // high<low/open/close
      { date: '2024-01-04', open: 10, high: 11, low: 9, close: 10.5, volume: -1, amount: 10500 }, // 负成交量
      { date: NaN as unknown as string, open: 10, high: 11, low: 9, close: 10.5, volume: 1000 }, // 非法时间
    ]);
    const res = await new StockSdkSource().getKline({ symbol: CN('600519'), period: 'day' });
    expect(res.length).toBe(1); // 仅 1 根合法
    expect(isValidCandle(res[0])).toBe(true);
    expect(res[0].datetime).toBe('2024-01-01');
  });

  it('全为脏数据时返回空数组（而非带 NaN 的数组），交由上层 fallback', async () => {
    mockSdk.kline.cn.mockResolvedValue([
      { date: '2024-01-02', open: NaN, high: 11, low: 9, close: 10.5, volume: 1000 },
      { date: '2024-01-03', open: 10, high: 5, low: 9, close: 10.5, volume: 1000 },
    ]);
    const res = await new StockSdkSource().getKline({ symbol: CN('600519'), period: 'day' });
    expect(res).toEqual([]);
    // 上层 MarketDataClient 在 data 为空时继续尝试下一个数据源
  });
});
