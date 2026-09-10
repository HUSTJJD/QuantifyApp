/**
 * 行情语义契约：禁止「上游无数据 → 伪造 0 价快照」。
 *
 * 背景：港美股 getQuotes 曾在查无数据时用 `{}` 映射出全 0 行情，
 * UI 显示 0 价且 partition 认为已覆盖而不再兜底。单元测试当时还
 * 把该行为写成了期望（「缺失返回 0 兜底」），catalog 断言只校验
 * last 是有限数（0 也算），三层都没拦住。
 *
 * 本文件补上语义层：
 *  1. 源层：查无数据必须跳过，不得返回全 0 行；
 *  2. catalog 层：assertResult 拒绝 last/prevClose 双 0。
 */
import { StockSdkSource } from '@/api/sources/StockSdkSource';
import { METHOD_CATALOG } from '@/api/contract/catalog';
import type { Symbol } from '@/api';

jest.mock('stock-sdk', () => {
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
  };
  return { StockSDK: jest.fn(() => mockSdk), __mockSdk: mockSdk };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __mockSdk: mockSdk } = jest.requireMock('stock-sdk') as {
  __mockSdk: { quotes: Record<string, jest.Mock> };
};

const HK = (code: string): Symbol => ({ code, exchange: 'HK' });
const CN = (code: string): Symbol => ({ code, exchange: 'SH' });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('行情语义契约 · 禁止伪造 0 价', () => {
  it('港股市上游返回空 → 不产出任何 Quote', async () => {
    mockSdk.quotes.hk.mockResolvedValue([]);
    const s = new StockSdkSource();
    const res = await s.getQuotes([HK('00700')]);
    expect(res).toEqual([]);
  });

  it('上游行无价格字段 → 不产出全 0 Quote', async () => {
    mockSdk.quotes.hk.mockResolvedValue([{ code: '00700', name: '腾讯' }]);
    const s = new StockSdkSource();
    const res = await s.getQuotes([HK('00700')]);
    expect(res).toEqual([]);
    expect(res.some((q) => q.last === 0 && q.prevClose === 0)).toBe(false);
  });

  it('混合批量：有数据的保留，无数据的跳过', async () => {
    mockSdk.quotes.cn.mockResolvedValue([{ code: '600519', price: 1800, prevClose: 1750 }]);
    mockSdk.quotes.hk.mockResolvedValue([]);
    const s = new StockSdkSource();
    const res = await s.getQuotes([CN('600519'), HK('00700')]);
    expect(res).toHaveLength(1);
    expect(res[0].symbol.code).toBe('600519');
    expect(res[0].last).toBe(1800);
  });

  it('catalog.getQuotes 断言拒绝全 0 快照', () => {
    const assert = METHOD_CATALOG.getQuotes.assertResult!;
    const zero = [{ symbol: { code: '00700', exchange: 'HK' }, last: 0, prevClose: 0 }] as never;
    const msg = assert(zero);
    expect(msg).not.toBeNull();
    expect(String(msg)).toMatch(/全为 0|伪造/);

    const ok = [{ symbol: { code: '600519', exchange: 'SH' }, last: 1800, prevClose: 1750 }] as never;
    expect(assert(ok)).toBeNull();
  });

  it('catalog.getIndexQuotes 断言拒绝全 0 快照', () => {
    const assert = METHOD_CATALOG.getIndexQuotes.assertResult!;
    const zero = [{ symbol: { code: '000300', exchange: 'SH' }, last: 0, prevClose: 0 }] as never;
    expect(assert(zero)).not.toBeNull();
    const ok = [{ symbol: { code: '000300', exchange: 'SH' }, last: 4000, prevClose: 3980 }] as never;
    expect(assert(ok)).toBeNull();
  });
});
