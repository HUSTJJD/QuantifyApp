/**
 * 行情接口真网集成测试（无 mock）。
 *
 * 直接调用真实数据源，断言返回值满足统一契约语义。
 * 运行：HITHINK_FINANCE_API_KEY=<key> yarn test apiLive
 */
import { FuyaoApiSource } from '@/api/sources/FuyaoApiSource';
import { HithsaApiSource } from '@/api/sources/HithsaApiSource';
import { HithsaHttpClient } from '@/api/sources/HithsaHttpClient';
import { StockSdkSource } from '@/api/sources/StockSdkSource';
import { DataSourceError } from '@/api/MarketDataSource';
import type { Candle, Quote, Symbol } from '@/api';

const CN: Symbol = { code: '600519', exchange: 'SH', name: '贵州茅台' };
const HK: Symbol = { code: '00700', exchange: 'HK', name: '腾讯控股' };
const US: Symbol = { code: 'AAPL', exchange: 'US', name: '苹果' };

const KEY = process.env.HITHINK_FINANCE_API_KEY ?? process.env.THS_API_KEY ?? '';
const hasKey = KEY.length > 0;

function assertQuote(q: Quote): void {
  expect(q.symbol).toBeDefined();
  expect(q.symbol.code.length).toBeGreaterThan(0);
  expect(Number.isFinite(q.last)).toBe(true);
  if (q.last === 0) {
    expect(q.prevClose).not.toBe(0);
  }
}

function assertCandle(c: Candle): void {
  expect(c.datetime).toBeDefined();
  for (const k of ['open', 'high', 'low', 'close'] as const) {
    expect(Number.isFinite(c[k])).toBe(true);
  }
  expect(c.high).toBeGreaterThanOrEqual(c.low);
  expect(c.open).toBeGreaterThanOrEqual(c.low - 1e-9);
  expect(c.open).toBeLessThanOrEqual(c.high + 1e-9);
  expect(c.close).toBeGreaterThanOrEqual(c.low - 1e-9);
  expect(c.close).toBeLessThanOrEqual(c.high + 1e-9);
}

function isUnsupported(e: unknown): boolean {
  return e instanceof DataSourceError && e.isUnsupported;
}

function isNetworkError(e: unknown): boolean {
  const err = e as Error & { cause?: Error & { cause?: Error } };
  const s = JSON.stringify({
    m: err?.message,
    c: err?.cause?.message,
    cc: err?.cause?.cause?.message,
  });
  return /fetch failed|Socket|network|ECONN|ETIMEDOUT|UND_ERR/i.test(s);
}

jest.setTimeout(90_000);

describe('stock-sdk 真网', () => {
  const src = new StockSdkSource();

  it('A股 getQuotes 600519', async () => {
    const res = await src.getQuotes([CN]);
    expect(res.length).toBe(1);
    assertQuote(res[0]);
    expect(res[0].last).toBeGreaterThan(0);
  });

  it('港股 getQuotes 00700', async () => {
    const res = await src.getQuotes([HK]);
    expect(res.length).toBe(1);
    assertQuote(res[0]);
    expect(res[0].last).toBeGreaterThan(0);
  });

  it('美股 getQuotes AAPL', async () => {
    const res = await src.getQuotes([US]);
    expect(res.length).toBe(1);
    assertQuote(res[0]);
    expect(res[0].last).toBeGreaterThan(0);
  });

  it('A股 getKline 日线 OHLC 合法（eastmoney 域名被拦则 skip）', async () => {
    let res;
    try {
      res = await src.getKline({ symbol: CN, period: 'day', count: 30 });
    } catch (e) {
      if (isNetworkError(e)) {
        console.warn('[skip] stock-sdk kline 网络不可达（push2his.eastmoney.com）');
        return;
      }
      throw e;
    }
    expect(res.length).toBeGreaterThan(0);
    for (const c of res) assertCandle(c);
  });

  it('港股 getKline 日线 OHLC 合法（eastmoney 域名被拦则 skip）', async () => {
    let res;
    try {
      res = await src.getKline({ symbol: HK, period: 'day', count: 30 });
    } catch (e) {
      if (isNetworkError(e)) {
        console.warn('[skip] stock-sdk HK kline 网络不可达');
        return;
      }
      throw e;
    }
    expect(res.length).toBeGreaterThan(0);
    for (const c of res) assertCandle(c);
  });

  it('getTradingDays 非空且含日期', async () => {
    const res = await src.getTradingDays();
    expect(res.length).toBeGreaterThan(0);
    expect(typeof res[0].dateMs).toBe('number');
    expect(res[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getLimitUpPool 结构合法', async () => {
    const res = await src.getLimitUpPool();
    expect(Array.isArray(res.items)).toBe(true);
    if (res.items.length > 0) {
      const it = res.items[0];
      expect(it.symbol.code.length).toBeGreaterThan(0);
      expect(Number.isFinite(it.lastPrice)).toBe(true);
    }
  });

  it('getStockIndustryBoard 板块列表非空', async () => {
    const res = await src.getStockIndustryBoard({ limit: 10 });
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].code).toMatch(/^BK/);
  });

  it('getNorthboundMinute 字段合法', async () => {
    try {
      const res = await src.getNorthboundMinute('north');
      if (res.length > 0) {
        expect(typeof res[0].time).toBe('string');
      }
    } catch (e) {
      if (!isUnsupported(e)) throw e;
    }
  });

  it('getValuations 估值字段', async () => {
    const res = await src.getValuations([CN]);
    if (res.length > 0) {
      expect(res[0].symbol.code).toBe('600519');
      // pe/pb 可空，但类型必须正确
      expect(res[0].peTtm == null || Number.isFinite(res[0].peTtm)).toBe(true);
    }
  });

  it('getMarginAccountInfo 两融账户', async () => {
    const res = await src.getMarginAccountInfo();
    if (res.length > 0) {
      expect(typeof res[0].date).toBe('string');
      expect(res[0].finBalance == null || Number.isFinite(res[0].finBalance)).toBe(true);
    }
  });

  it('getFundNav 基金净值', async () => {
    const fund: Symbol = { code: '161725', exchange: 'OF' };
    try {
      const res = await src.getFundNav(fund, 'otc');
      if (res.length > 0) {
        expect(res[0].navDate).toBeTruthy();
        expect(res[0].unitNav == null || Number.isFinite(res[0].unitNav)).toBe(true);
      }
    } catch (e) {
      if (!isUnsupported(e)) throw e;
    }
  });

  it('getChipDistribution 筹码（有数据则校验区间；依赖 K 线，域名被拦则 skip）', async () => {
    try {
      const res = await src.getChipDistribution({ symbol: CN, range: 30 });
      if (res.length > 0) {
        const p = res[0];
        if (p.profitRatio != null) {
          expect(p.profitRatio).toBeGreaterThanOrEqual(0);
          expect(p.profitRatio).toBeLessThanOrEqual(1);
        }
      }
    } catch (e) {
      if (isUnsupported(e) || isNetworkError(e)) {
        console.warn('[skip] getChipDistribution', isNetworkError(e) ? '网络不可达' : '不支持');
        return;
      }
      throw e;
    }
  });
});

const describeFuyao = hasKey ? describe : describe.skip;
describeFuyao('fuyao 真网', () => {
  const src = new FuyaoApiSource(() => KEY);

  it('A股 getQuotes', async () => {
    const res = await src.getQuotes([CN]);
    expect(res.length).toBe(1);
    assertQuote(res[0]);
    expect(res[0].last).toBeGreaterThan(0);
  });

  it('getKline 日线', async () => {
    const res = await src.getKline({ symbol: CN, period: 'day', count: 30 });
    expect(res.length).toBeGreaterThan(0);
    for (const c of res) assertCandle(c);
  });

  it('getTradingDays', async () => {
    const res = await src.getTradingDays();
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getValuations', async () => {
    const res = await src.getValuations([CN]);
    expect(res.length).toBe(1);
    expect(res[0].symbol.code).toBe('600519');
    expect(res[0].peTtm == null || Number.isFinite(res[0].peTtm)).toBe(true);
  });

  it('getFinancials 财报摘要', async () => {
    const res = await src.getFinancials('600519');
    expect(Array.isArray(res)).toBe(true);
    if (res.length > 0) {
      expect(res[0].periodEndMs == null || Number.isFinite(res[0].periodEndMs)).toBe(true);
    }
  });

  it('getLimitDownPool 跌停池', async () => {
    const res = await src.getLimitDownPool();
    expect(Array.isArray(res.items)).toBe(true);
    if (res.items.length > 0) {
      expect(res.items[0].symbol.code.length).toBeGreaterThan(0);
    }
  });
});

describe('hithsa 真网', () => {
  const src = new HithsaApiSource(new HithsaHttpClient(() => KEY || undefined));

  it('港股 getQuotes 应 3004（官方不支持）', async () => {
    await expect(src.getQuotes([HK])).rejects.toMatchObject({ upstreamCode: 3004 });
  });

  const itA = hasKey ? it : it.skip;
  itA('A股 getQuotes', async () => {
    try {
      const res = await src.getQuotes([CN]);
      expect(res.length).toBe(1);
      assertQuote(res[0]);
    } catch (e) {
      if (!isUnsupported(e)) throw e;
    }
  });
});
