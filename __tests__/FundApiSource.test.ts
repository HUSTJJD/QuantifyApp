/**
 * FundApiSource 单元测试
 *
 * 覆盖：对 npm:fund-api 的【纯封装】行为——
 *  - 基金代码格式转换（本项目 OF.000001 -> 库纯数字 000001）；
 *  - getFundMarketSnapshot / getFundProfile / getFundNav / getFundHistorical /
 *    search 对库返回结构的字段映射；
 *  - getFund 返回空（无效代码）-> 抛 3004；
 *  - getNavHistory 空 -> 抛 3004；
 *  - 持仓/收益/持有人等库不支持的能力 -> 由基类抛 3004。
 *
 * 测试通过 mock fund-api 的 funds.auto 完成（薄封装，不触达真实网络）。
 */
import { FundApiSource } from '@/api/sources/FundApiSource';
import { DataSourceError } from '@/api/MarketDataSource';
import type { Symbol } from '@/api';

jest.mock('fund-api', () => ({
  funds: {
    auto: {
      getFund: jest.fn(),
      getFunds: jest.fn(),
      getNavHistory: jest.fn(),
      searchFunds: jest.fn(),
    },
  },
}));
const { funds } = require('fund-api');

const FUND = (code: string): Symbol => ({ code, exchange: 'OF' });

const fundRaw = (code: string, name = '测试基金') => ({
  code,
  name,
  nav: 1.403,
  accNav: 3.976,
  change: 4.0801,
  navDate: '2026-08-17',
  source: 'tencent',
});
const navRaw = (date: string, nav = 1.403, accNav = 3.976) => ({ date, nav, accNav, source: 'tencent' });

beforeEach(() => jest.clearAllMocks());

describe('FundApiSource 代码格式转换', () => {
  it('getFund 调用透传纯数字 code（OF.000001 -> 000001）', async () => {
    funds.auto.getFund = jest.fn().mockResolvedValue(fundRaw('000001'));
    await new FundApiSource().getFundMarketSnapshot(FUND('000001'));
    expect(funds.auto.getFund.mock.calls[0][0]).toBe('000001');
  });
});

describe('FundApiSource.getFundMarketSnapshot 字段映射', () => {
  it('映射 Fund -> Quote（nav 作 last，accNav 作 prevClose）', async () => {
    funds.auto.getFund = jest.fn().mockResolvedValue(fundRaw('000001', '华夏成长混合'));
    const q = await new FundApiSource().getFundMarketSnapshot(FUND('000001'));
    expect(q).toMatchObject({
      symbol: { code: '000001', exchange: 'OF' },
      last: 1.403,
      prevClose: 3.976,
      changePct: 408.01,
      updatedAt: expect.any(Number),
    });
  });

  it('无效代码（库返回空对象）-> 抛 3004', async () => {
    funds.auto.getFund = jest.fn().mockResolvedValue({});
    let code: unknown;
    try {
      await new FundApiSource().getFundMarketSnapshot(FUND('999999'));
    } catch (e) {
      code = (e as DataSourceError).upstreamCode;
    }
    expect(code).toBe(3004);
  });
});

describe('FundApiSource.getFundProfile 字段映射', () => {
  it('映射 Fund -> FundProfile（仅 name 可用，其余留 null）', async () => {
    funds.auto.getFund = jest.fn().mockResolvedValue(fundRaw('110011', '易方达优质精选混合(QDII)'));
    const p = await new FundApiSource().getFundProfile(FUND('110011'), 'otc');
    expect(p).toEqual({
      symbol: { code: '110011', exchange: 'OF' },
      ticker: '110011',
      fundName: '易方达优质精选混合(QDII)',
      estabDateMs: null,
      mgmtName: null,
      managerName: null,
    });
  });
});

describe('FundApiSource.getFundNav 字段映射', () => {
  it('映射 FundNavHistoryItem[] -> FundNav[]', async () => {
    funds.auto.getNavHistory = jest.fn().mockResolvedValue([
      navRaw('2026-08-17'),
      navRaw('2026-08-14', 1.39, 3.95),
    ]);
    const navs = await new FundApiSource().getFundNav(FUND('000001'), 'otc');
    expect(navs).toEqual([
      { symbol: { code: '000001', exchange: 'OF' }, navDate: '2026-08-17', unitNav: 1.403, adjNav: 3.976 },
      { symbol: { code: '000001', exchange: 'OF' }, navDate: '2026-08-14', unitNav: 1.39, adjNav: 3.95 },
    ]);
  });

  it('空历史 -> 抛 3004', async () => {
    funds.auto.getNavHistory = jest.fn().mockResolvedValue([]);
    let code: unknown;
    try {
      await new FundApiSource().getFundNav(FUND('000001'), 'otc');
    } catch (e) {
      code = (e as DataSourceError).upstreamCode;
    }
    expect(code).toBe(3004);
  });
});

describe('FundApiSource.getFundHistorical 区间过滤', () => {
  it('按 [startMs, endMs] 过滤净值 -> Candle[]', async () => {
    funds.auto.getNavHistory = jest.fn().mockResolvedValue([
      navRaw('2026-08-10'),
      navRaw('2026-08-15'),
      navRaw('2026-08-20'),
    ]);
    const startMs = new Date('2026-08-14').getTime();
    const endMs = new Date('2026-08-18').getTime();
    const candles = await new FundApiSource().getFundHistorical(FUND('000001'), startMs, endMs);
    expect(candles.map((c) => c.datetime)).toEqual(['2026-08-15']);
    expect(candles[0]).toMatchObject({ open: 1.403, close: 1.403, amount: 3.976 });
  });

  it('区间内无数据 -> 抛 3004', async () => {
    funds.auto.getNavHistory = jest.fn().mockResolvedValue([navRaw('2026-01-01')]);
    let code: unknown;
    try {
      await new FundApiSource().getFundHistorical(
        FUND('000001'),
        new Date('2026-08-01').getTime(),
        new Date('2026-08-31').getTime(),
      );
    } catch (e) {
      code = (e as DataSourceError).upstreamCode;
    }
    expect(code).toBe(3004);
  });
});

describe('FundApiSource.search 字段映射', () => {
  it('映射 FundSearchResult -> Instrument', async () => {
    funds.auto.searchFunds = jest.fn().mockResolvedValue([
      { code: '000001', name: '华夏成长混合', pinyin: 'hxcz', type: '混合型', source: 'tencent' },
    ]);
    const results = await new FundApiSource().search({ keyword: '华夏' });
    expect(results).toEqual([
      { symbol: { code: '000001', exchange: 'OF' }, name: '华夏成长混合', market: 'A' },
    ]);
  });

  it('空结果返回 []', async () => {
    funds.auto.searchFunds = jest.fn().mockResolvedValue(null);
    expect(await new FundApiSource().search({ keyword: 'xyz' })).toEqual([]);
  });
});

describe('FundApiSource 不在库覆盖的能力应抛 3004', () => {
  const unsupported: Array<[string, () => Promise<unknown>]> = [
    ['getFundHoldings', () => new FundApiSource().getFundHoldings(FUND('000001'), 'otc')],
    ['getFundReturns', () => new FundApiSource().getFundReturns(FUND('000001'), 'otc')],
    ['getFundHolders', () => new FundApiSource().getFundHolders(FUND('000001'), 'otc')],
    ['getQuotes', () => new FundApiSource().getQuotes([FUND('000001')])],
    ['getOrderBook', () => new FundApiSource().getOrderBook(FUND('000001'))],
    ['getKline', () => new FundApiSource().getKline({ symbol: FUND('000001'), period: 'day', count: 1 })],
    ['getIncomeStatements', () => new FundApiSource().getIncomeStatements({ symbol: FUND('000001'), period: 'annual' })],
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
