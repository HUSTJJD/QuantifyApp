/**
 * 全市场增量同步引擎单测。
 * - syncTickers：分页拉取 -> 标的库写入（内存回落引擎）
 * - syncKlineIncremental：增量写库、防抖跳过、失败计数
 * mock marketData 单例与 database() 内存引擎（jest 下回落 AsyncStorage）。
 */
import { marketData } from '@/data/api';
import { database, resetDatabase } from '@/data/db';
import { MarketMetaStore } from '@/data/db/MarketMetaStore';
import { syncKlineIncremental, syncTickers, MIN_SYNC_INTERVAL_MS, INCREMENTAL_COUNT, FULL_HISTORY_COUNT } from '@/data/sync/MarketSync';
import type { Candle, Symbol } from '@/data/api';

const SYM_A: Symbol = { code: '600519', exchange: 'SH', name: '贵州茅台' };
const SYM_B: Symbol = { code: '000001', exchange: 'SZ', name: '平安银行' };

function candle(ts: number, close: number): Candle {
  return { datetime: ts, open: close, high: close, low: close, close, volume: 1000, amount: 10000 };
}

describe('MarketMetaStore（内存回落引擎）', () => {
  it('replaceTickers + getTickers + count', async () => {
    const store = new MarketMetaStore();
    await store.replaceTickers([
      { symbol: SYM_A, name: '贵州茅台', assetType: 'a-share', market: 'A' as const },
      { symbol: SYM_B, name: '平安银行', assetType: 'a-share', market: 'A' as const },
    ]);
    expect(await store.countTickers()).toBe(2);
    const list = await store.getTickers();
    expect(list.map((t) => t.symbol).sort()).toEqual(['SH.600519', 'SZ.000001']);
  });

  it('sync_state 写入与读取', async () => {
    const store = new MarketMetaStore();
    await store.setSyncState('SH.600519', 'day', 12345);
    expect(await store.getSyncState('SH.600519', 'day')).toBe(12345);
    expect(await store.getSyncState('SH.600519', 'week')).toBe(0);
  });
});

describe('syncTickers 分页拉取全市场标的', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    resetDatabase();
    MarketMetaStore.resetMem();
  });

  it('分页聚合：2 页各 1000 条', async () => {
    const page = (n: number, start: number) =>
      Array.from({ length: n }, (_, i) => ({
        symbol: { code: String(start + i), exchange: 'SH' as const },
        name: `股票${start + i}`,
        assetType: 'a-share' as const,
        market: 'A' as const,
      }));
    const spy = jest
      .spyOn(marketData, 'listTickers')
      .mockImplementation(async (opts) =>
        opts?.offset === 0 ? page(1000, 600000) : page(500, 601000),
      );
    const n = await syncTickers();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(n).toBe(1500);
    expect(await database().count()).toBe(0); // kline 表未写
  });
});

describe('syncKlineIncremental 增量同步', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    resetDatabase();
    MarketMetaStore.resetMem();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    AsyncStorage.__reset?.();
  });

  it('无标的库时先拉取标的，再对每个标的全量写库', async () => {
    jest.spyOn(marketData, 'listTickers').mockResolvedValue([
      { symbol: SYM_A, name: '贵州茅台', assetType: 'a-share', market: 'A' as const },
    ]);
    jest.spyOn(marketData, 'getKline').mockResolvedValue([candle(1, 10), candle(2, 20)]);
    const res = await syncKlineIncremental('day', 2);
    expect(res.total).toBe(1);
    expect(res.failed).toBe(0);
    const rows = await database().getCandles(SYM_A, 'day');
    expect(rows).toHaveLength(2);
  });

  it('防抖：间隔未到跳过（不重复拉取）', async () => {
    jest.spyOn(marketData, 'listTickers').mockResolvedValue([
      { symbol: SYM_A, name: '贵州茅台', assetType: 'a-share', market: 'A' as const },
    ]);
    const store = new MarketMetaStore();
    await store.setSyncState('SH.600519', 'day', Date.now()); // 刚同步过
    const getKline = jest.spyOn(marketData, 'getKline').mockResolvedValue([candle(1, 10)]);
    const res = await syncKlineIncremental('day', 2);
    expect(res.skipped).toBe(1);
    expect(getKline).not.toHaveBeenCalled();
  });

  it('失败计数：getKline 抛错计入 failed 且不中断其它标的', async () => {
    jest.spyOn(marketData, 'listTickers').mockResolvedValue([
      { symbol: SYM_A, name: '贵州茅台', assetType: 'a-share', market: 'A' as const },
      { symbol: SYM_B, name: '平安银行', assetType: 'a-share', market: 'A' as const },
    ]);
    jest
      .spyOn(marketData, 'getKline')
      .mockImplementation(async (params: { symbol: Symbol }) =>
        params.symbol.code === '600519' ? Promise.reject(new Error('network down')) : Promise.resolve([candle(3, 30)]),
      );
    const res = await syncKlineIncremental('day', 2);
    expect(res.total).toBe(2);
    expect(res.failed).toBe(1);
    const rows = await database().getCandles(SYM_B, 'day');
    expect(rows).toHaveLength(1);
  });

  it('进度回调携带 total/done/skipped/failed', async () => {
    jest.spyOn(marketData, 'listTickers').mockResolvedValue([
      { symbol: SYM_A, name: '贵州茅台', assetType: 'a-share', market: 'A' as const },
    ]);
    jest.spyOn(marketData, 'getKline').mockResolvedValue([candle(1, 10)]);
    const progress: number[] = [];
    await syncKlineIncremental('day', 2, (p) => progress.push(p.done));
    expect(progress).toEqual([1]);
    expect(MIN_SYNC_INTERVAL_MS).toBeGreaterThan(0);
    expect(INCREMENTAL_COUNT).toBe(60);
    expect(FULL_HISTORY_COUNT).toBeGreaterThanOrEqual(700);
  });
});
