/**
 * StockApiSource 单元测试
 *
 * 覆盖：对 npm:stock-api 的【纯封装】行为——
 *  - toProviderCode / fromProviderCode 代码格式转换（SH600519 大写无点）；
 *  - getQuotes / getKline / search 对库返回结构的字段映射；
 *  - 复权(forward/backward)库不支持 -> 抛 3004 交兜底源；
 *  - 空结果 -> 抛 3004 以触发 fallback；
 *  - 盘口/财务等库不支持的能力 -> 抛 3004；
 *  - 周/月/分钟级 K 线透传库。
 *
 * 测试通过 mock stock-api 的 stocks.auto 完成（薄封装，不触达真实网络）。
 */
import { StockApiSource } from '@/api/sources/StockApiSource';
import { DataSourceError } from '@/api/MarketDataSource';
import type { Symbol } from '@/api';

// 纯封装：仅 mock stock-api 库自身，不 mock globalThis.fetch
jest.mock('stock-api', () => ({
  stocks: {
    auto: {
      getStocks: jest.fn(),
      getKlines: jest.fn(),
      searchStocks: jest.fn(),
    },
  },
}));
const { stocks } = require('stock-api');

const SYM = (code: string, exchange: Symbol['exchange']): Symbol => ({ code, exchange });

const quoteRaw = (code: string, name = '测试') => ({
  code,
  name,
  percent: 1.5,
  now: 1700,
  yesterday: 1680,
  open: 1685,
  high: 1710,
  low: 1680,
  volume: 32145,
  amount: 5.4e8,
  turnover: 5.4e8,
});

const klineRaw = (date: string) => ({
  date,
  open: 1685,
  high: 1710,
  low: 1680,
  close: 1702.5,
  volume: 32145,
  amount: 5.4e8,
});

beforeEach(() => jest.clearAllMocks());

describe('StockApiSource 代码格式转换', () => {
  it.each<[Symbol, string]>([
    [SYM('600519', 'SH'), 'SH600519'],
    [SYM('000651', 'SZ'), 'SZ000651'],
    [SYM('899050', 'BJ'), 'BJ899050'],
    [SYM('00700', 'HK'), 'HK00700'],
    [SYM('AAPL', 'US'), 'USAAPL'],
  ])('toProviderCode(%o) -> %s', async (symbol, expected) => {
    stocks.auto.getKlines = jest.fn().mockResolvedValue([klineRaw('2024-01-02')]);
    await new StockApiSource().getKline({ symbol, period: 'day', count: 1 });
    expect(stocks.auto.getKlines.mock.calls[0][0]).toBe(expected);
  });
});

describe('StockApiSource.getQuotes 字段映射', () => {
  it('映射库 Stock -> 统一 Quote', async () => {
    stocks.auto.getStocks = jest.fn().mockResolvedValue([
      quoteRaw('SH600519', '贵州茅台'),
    ]);
    const quotes = await new StockApiSource().getQuotes([SYM('600519', 'SH')]);
    expect(quotes).toEqual([
      {
        symbol: { code: '600519', exchange: 'SH' },
        last: 1700,
        prevClose: 1680,
        open: 1685,
        high: 1710,
        low: 1680,
        volume: 32145,
        amount: 5.4e8,
        changePct: 150,
        updatedAt: expect.any(Number),
      },
    ]);
  });

  it('库未返回的标的被跳过', async () => {
    stocks.auto.getStocks = jest.fn().mockResolvedValue([quoteRaw('SH600519')]);
    const quotes = await new StockApiSource().getQuotes([SYM('600519', 'SH'), SYM('000651', 'SZ')]);
    expect(quotes).toHaveLength(1);
  });

  it('空入参直接返回 []', async () => {
    expect(await new StockApiSource().getQuotes([])).toEqual([]);
  });
});

describe('StockApiSource.getKline 字段映射与透传', () => {
  it('映射库 Kline -> 统一 Candle', async () => {
    stocks.auto.getKlines = jest.fn().mockResolvedValue([klineRaw('2024-01-02')]);
    const candles = await new StockApiSource().getKline({ symbol: SYM('600519', 'SH'), period: 'day', count: 1 });
    expect(candles).toEqual([
      { datetime: '2024-01-02', open: 1685, high: 1710, low: 1680, close: 1702.5, volume: 32145, amount: 5.4e8 },
    ]);
  });

  it('周/月/分钟级透传库', async () => {
    for (const period of ['week', 'month', '1m'] as const) {
      stocks.auto.getKlines = jest.fn().mockResolvedValue([klineRaw('2024-01-05')]);
      const candles = await new StockApiSource().getKline({ symbol: SYM('000651', 'SZ'), period, count: 1 });
      expect(candles).toHaveLength(1);
      expect(stocks.auto.getKlines.mock.calls[0][1]).toMatchObject({ period, count: 1 });
    }
  });

  it('adjust=none 透传给库', async () => {
    stocks.auto.getKlines = jest.fn().mockResolvedValue([klineRaw('2024-01-02')]);
    await new StockApiSource().getKline({ symbol: SYM('600519', 'SH'), period: 'day', count: 1, adjust: 'none' });
    expect(stocks.auto.getKlines.mock.calls[0][1]).toMatchObject({ period: 'day', count: 1 });
  });

  it('复权(forward/backward)库暂不支持 -> 抛 3004 交兜底源', async () => {
    await expect(
      new StockApiSource().getKline({ symbol: SYM('600519', 'SH'), period: 'day', count: 1, adjust: 'forward' }),
    ).rejects.toBeInstanceOf(DataSourceError);
    try {
      await new StockApiSource().getKline({ symbol: SYM('600519', 'SH'), period: 'day', count: 1, adjust: 'forward' });
    } catch (e) {
      expect((e as DataSourceError).upstreamCode).toBe(3004);
    }
  });

  it('空结果抛出 DataSourceError(3004) 而非静默返回空', async () => {
    stocks.auto.getKlines = jest.fn().mockResolvedValue([]);
    await expect(
      new StockApiSource().getKline({ symbol: SYM('600519', 'SH'), period: 'day', count: 1 }),
    ).rejects.toBeInstanceOf(DataSourceError);
    try {
      await new StockApiSource().getKline({ symbol: SYM('600519', 'SH'), period: 'day', count: 1 });
    } catch (e) {
      expect((e as DataSourceError).upstreamCode).toBe(3004);
    }
  });
});

describe('StockApiSource.getOrderBook 契约', () => {
  it('库不提供盘口 -> 抛 3004 交 stock-sdk 兜底', async () => {
    let code: unknown;
    try {
      await new StockApiSource().getOrderBook(SYM('600519', 'SH'));
    } catch (e) {
      code = (e as DataSourceError).upstreamCode;
    }
    expect(code).toBe(3004);
  });
});

describe('StockApiSource.search 字段映射', () => {
  it('映射港股/美股/A股市场分类', async () => {
    stocks.auto.searchStocks = jest.fn().mockResolvedValue([
      { code: 'SH600519', name: '贵州茅台' },
      { code: 'HK00700', name: '腾讯控股' },
      { code: 'USAAPL', name: '苹果' },
    ]);
    const results = await new StockApiSource().search({ keyword: '茅台' });
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ name: '贵州茅台', market: 'A', symbol: { code: '600519', exchange: 'SH' } });
    expect(results[1]).toMatchObject({ name: '腾讯控股', market: 'HK', symbol: { code: '00700', exchange: 'HK' } });
    expect(results[2]).toMatchObject({ name: '苹果', market: 'US', symbol: { code: 'AAPL', exchange: 'US' } });
  });

  it('空结果返回 []', async () => {
    stocks.auto.searchStocks = jest.fn().mockResolvedValue(null);
    expect(await new StockApiSource().search({ keyword: 'xyz' })).toEqual([]);
  });
});

describe('StockApiSource 不在库覆盖的能力应抛 3004', () => {
  const unsupported: Array<[string, () => Promise<unknown>]> = [
    ['getValuations', () => new StockApiSource().getValuations([SYM('600519', 'SH')])],
    ['getIncomeStatements', () => new StockApiSource().getIncomeStatements({ symbol: SYM('600519', 'SH'), period: 'annual' })],
    ['getBalanceSheets', () => new StockApiSource().getBalanceSheets({ symbol: SYM('600519', 'SH'), period: 'annual' })],
    ['getCashFlowStatements', () => new StockApiSource().getCashFlowStatements({ symbol: SYM('600519', 'SH'), period: 'annual' })],
    ['getFinancialIndicators', () => new StockApiSource().getFinancialIndicators({ symbol: SYM('600519', 'SH'), report: 'annual' })],
  ];
  it.each(unsupported)('%s 抛 DataSourceError(3004)', async (_name, fn) => {
    let code: unknown;
    try {
      await fn();
    } catch (e) {
      code = (e as DataSourceError).upstreamCode;
    }
    expect(code).toBe(3004);
  });
});
