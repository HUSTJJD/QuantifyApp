/**
 * useSyncStatus 底层统计 + 复权因子存储单测。
 * 验证：MarketMetaStore 复权因子读写、全量统计（内存回落引擎）。
 */
import { database, resetDatabase } from '@/db';
import { MarketMetaStore } from '@/db/MarketMetaStore';
import type { Candle, Symbol } from '@/api';

const SYM_A: Symbol = { code: '600519', exchange: 'SH' };

function candle(ts: number, close: number): Candle {
  return { datetime: ts, open: close, high: close, low: close, close, volume: 100 };
}

describe('MarketMetaStore 复权因子存储', () => {
  beforeEach(() => {
    MarketMetaStore.resetMem();
    resetDatabase();
  });

  it('replaceFactors + getFactors 读写', async () => {
    const store = new MarketMetaStore();
    await store.replaceFactors('SH.600519', [
      { symbol: 'SH.600519', exDateMs: 1000, dividendPerShare: 1.5, perShareBonus: 0.1, allotmentRatio: null, allotmentPrice: null },
      { symbol: 'SH.600519', exDateMs: 2000, dividendPerShare: null, perShareBonus: 0.2, allotmentRatio: 0.3, allotmentPrice: 12 },
    ]);
    const factors = await store.getFactors('SH.600519');
    expect(factors).toHaveLength(2);
    expect(factors[0].exDateMs).toBe(1000);
    expect(factors[1].allotmentRatio).toBe(0.3);
    // 按除权日升序
    expect(factors.map((f) => f.exDateMs)).toEqual([1000, 2000]);
  });

  it('replaceFactors 同标的覆盖（全量替换）', async () => {
    const store = new MarketMetaStore();
    await store.replaceFactors('SH.600519', [{ symbol: 'SH.600519', exDateMs: 1000, dividendPerShare: 1, perShareBonus: null, allotmentRatio: null, allotmentPrice: null }]);
    await store.replaceFactors('SH.600519', [{ symbol: 'SH.600519', exDateMs: 3000, dividendPerShare: 2, perShareBonus: null, allotmentRatio: null, allotmentPrice: null }]);
    const factors = await store.getFactors('SH.600519');
    expect(factors).toHaveLength(1);
    expect(factors[0].exDateMs).toBe(3000);
  });

  it('getFactorsAll 汇总全部标的因子', async () => {
    const store = new MarketMetaStore();
    await store.replaceFactors('SH.600519', [{ symbol: 'SH.600519', exDateMs: 1000, dividendPerShare: 1, perShareBonus: null, allotmentRatio: null, allotmentPrice: null }]);
    await store.replaceFactors('SZ.000001', [{ symbol: 'SZ.000001', exDateMs: 2000, dividendPerShare: 2, perShareBonus: null, allotmentRatio: null, allotmentPrice: null }]);
    expect((await store.getFactorsAll()).length).toBe(2);
  });

  it('本地库统计：kline 行数 + 标的数 + 同步状态', async () => {
    await database().saveCandles(SYM_A, 'day', [candle(1, 10), candle(2, 20)]);
    const store = new MarketMetaStore();
    await store.replaceTickers([{ symbol: SYM_A, name: '茅台', assetType: 'a-share', market: 'A' as const }]);
    await store.setSyncState('SH.600519', 'day', Date.now());
    expect(await database().count()).toBe(2);
    expect(await store.countTickers()).toBe(1);
    expect((await store.getSyncStates()).length).toBe(1);
  });
});
