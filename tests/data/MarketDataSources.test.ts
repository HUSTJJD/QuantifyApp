const LIVE = process.env.RUN_LIVE_TESTS === '1';
const d = LIVE ? describe : describe.skip;
/**
 * API 数据源测试。
 *
 * - stock-sdk：npm 包直连，无需 Key，真网拉行情（必跑必过）；
 *
 * 运行：yarn jest __tests__/MarketDataSources.test.ts
 */
import { StockSdkSource } from '@/data/api/sources/StockSdkSource';
import type { Symbol } from '@/data/api/types';

const A_SHARE: Symbol = { code: '600519', exchange: 'SH', name: '贵州茅台' };
const HK: Symbol = { code: '00700', exchange: 'HK', name: '腾讯控股' };

/** 校验一条行情确实拉到了真实非零数据 */
function expectValidQuote(q: {
  last: number;
  prevClose: number;
  high: number;
  low: number;
}): void {
  expect(Number.isFinite(q.last)).toBe(true);
  expect(q.last).toBeGreaterThan(0);
  expect(q.prevClose).toBeGreaterThan(0);
  expect(q.high).toBeGreaterThanOrEqual(q.low);
  expect(q.high).toBeGreaterThan(0);
  expect(q.low).toBeGreaterThan(0);
}

d('数据源 - stock-sdk（必跑）', () => {
  const src = new StockSdkSource();

  it('getQuotes 能拉到 A 股真实行情', async () => {
    const quotes = await src.getQuotes([A_SHARE]);
    expect(quotes.length).toBe(1);
    expectValidQuote(quotes[0]);
  }, 20000);

  it('getQuotes 能拉到港股真实行情', async () => {
    const quotes = await src.getQuotes([HK]);
    expect(quotes.length).toBe(1);
    expect(quotes[0].symbol.exchange).toBe('HK');
    expectValidQuote(quotes[0]);
  }, 20000);
});
