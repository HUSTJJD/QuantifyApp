/**
 * MethodCache 读穿缓存单测（MemoryStorage，不联网）。
 * 覆盖：领域表路由 / fallback 表 / 未登记不缓存 / 空结果策略。
 */
import { MemoryStorageAdapter, setStorage, StorageKeys } from '@/data/db/storage';
import { resetQuantStore } from '@/data/db/QuantStore';
import { resetDomainCache } from '@/data/db/DomainCache';
import {
  methodCacheKey,
  readThroughCache,
  clearMethodCache,
  METHOD_CACHE_POLICIES,
} from '@/data/api/MethodCache';
import type { DataSourceMethod, Quote, Symbol } from '@/data/api';

beforeEach(() => {
  setStorage(new MemoryStorageAdapter());
  resetQuantStore();
  resetDomainCache();
});

const METHODS_WITH_POLICY = Object.keys(METHOD_CACHE_POLICIES) as DataSourceMethod[];

describe('MethodCache', () => {
  it('未登记策略的方法不走缓存', async () => {
    let n = 0;
    const fetch = async () => {
      n += 1;
      return [n] as never;
    };
    const m = 'getProfitForecast' as DataSourceMethod;
    expect(METHOD_CACHE_POLICIES[m]).toBeUndefined();
    await readThroughCache(m, [] as never, fetch);
    await readThroughCache(m, [] as never, fetch);
    expect(n).toBe(2);
  });

  it('领域表路由：getQuotes 落 quote_snapshot，命中不重复 fetch', async () => {
    expect(METHOD_CACHE_POLICIES.getQuotes?.store).toBe('domain');
    let n = 0;
    const sym: Symbol = { code: '600519', exchange: 'SH' };
    const quote: Quote = {
      symbol: sym,
      last: 1800,
      prevClose: 1750,
      open: 1760,
      high: 1810,
      low: 1755,
      volume: 1000,
      amount: 1.8e6,
      changePct: 2.86,
    };
    const fetch = async () => {
      n += 1;
      return [quote] as never;
    };
    const args = [[sym]] as never;
    const a = await readThroughCache('getQuotes' as DataSourceMethod, args, fetch);
    await new Promise<void>((r) => setTimeout(r, 15));
    const b = await readThroughCache('getQuotes' as DataSourceMethod, args, fetch);
    expect(a).toEqual([quote]);
    expect(b).toEqual([quote]);
    expect(n).toBe(1);
  });

  it('领域表路由：getTradingDays 落 trading_calendar', async () => {
    expect(METHOD_CACHE_POLICIES.getTradingDays?.store).toBe('domain');
    let n = 0;
    const days = [
      { dateMs: 1704067200000, date: '2024-01-02' },
      { dateMs: 1704153600000, date: '2024-01-03' },
    ];
    const fetch = async () => {
      n += 1;
      return days as never;
    };
    const args = [] as never;
    await readThroughCache('getTradingDays' as DataSourceMethod, args, fetch);
    await new Promise<void>((r) => setTimeout(r, 15));
    await readThroughCache('getTradingDays' as DataSourceMethod, args, fetch);
    expect(n).toBe(1);
  });

  it('fallback 路由：search 落 method_cache', async () => {
    expect(METHOD_CACHE_POLICIES.search?.store).toBe('fallback');
    let n = 0;
    const fetch = async () => {
      n += 1;
      return [{ symbol: { code: '600519', exchange: 'SH' }, name: '贵州茅台', market: 'A' }] as never;
    };
    const args = [{ keyword: '茅台' }] as never;
    await readThroughCache('search' as DataSourceMethod, args, fetch);
    await new Promise<void>((r) => setTimeout(r, 15));
    await readThroughCache('search' as DataSourceMethod, args, fetch);
    expect(n).toBe(1);
  });

  it('空数组默认不缓存', async () => {
    let n = 0;
    const fetch = async () => {
      n += 1;
      return [] as never;
    };
    const method = 'getLimitUpPool' as DataSourceMethod;
    const args = [{}] as never;
    await readThroughCache(method, args, fetch);
    await new Promise<void>((r) => setTimeout(r, 15));
    await readThroughCache(method, args, fetch);
    expect(n).toBe(2);
  });

  it('cacheEmpty=true 时空结果也可缓存', async () => {
    let n = 0;
    const fetch = async () => {
      n += 1;
      return [] as never;
    };
    const method = 'getTradingDays' as DataSourceMethod;
    const args = [] as never;
    await readThroughCache(method, args, fetch);
    await new Promise<void>((r) => setTimeout(r, 15));
    await readThroughCache(method, args, fetch);
    expect(n).toBe(1);
  });

  it('K 线不进 MethodCache（由 KlineDatabase 领域库负责）', () => {
    expect(METHOD_CACHE_POLICIES.getKline).toBeUndefined();
    expect(METHOD_CACHE_POLICIES.getIndexKline).toBeUndefined();
    expect(METHOD_CACHE_POLICIES.getKlineWithIndicators).toBeUndefined();
  });

  it('策略表覆盖核心高频方法，且核心行情走 domain', () => {
    const domainMethods = [
      'getQuotes', 'getIndexQuotes', 'getTradingDays', 'isTradingDay',
      'getMainForce', 'getStockFundsFlowing', 'getLimitUpPool',
      'getStockIndustryBoard', 'getConceptBoards', 'getNorthboundMinute',
      'getMarginAccountInfo', 'getDragonTigerStockStats',
    ] as DataSourceMethod[];
    for (const m of domainMethods) {
      expect(METHOD_CACHE_POLICIES[m]?.store).toBe('domain');
    }
    expect(METHODS_WITH_POLICY.length).toBeGreaterThan(30);
  });

  it('methodCacheKey 键唯一', () => {
    expect(
      methodCacheKey('getQuotes' as DataSourceMethod, [[{ code: '1', exchange: 'SH' }]]),
    ).not.toBe(
      methodCacheKey('getQuotes' as DataSourceMethod, [[{ code: '2', exchange: 'SH' }]]),
    );
  });

  it('StorageKeys.METHOD_CACHE_PREFIX 已登记', () => {
    expect(StorageKeys.METHOD_CACHE_PREFIX).toBe('app.cache.mdc.');
  });

  it('clearMethodCache 后 fallback 重新 fetch', async () => {
    let n = 0;
    const fetch = async () => {
      n += 1;
      return { code: '600519' } as never;
    };
    const method = 'search' as DataSourceMethod;
    const args = [{ keyword: '茅台' }] as never;
    await readThroughCache(method, args, fetch);
    await new Promise<void>((r) => setTimeout(r, 15));
    await clearMethodCache(method, args as unknown[]);
    await readThroughCache(method, args, fetch);
    expect(n).toBe(2);
  });
});
