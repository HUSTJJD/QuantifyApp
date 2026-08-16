/**
 * K 线数据库机制单测（基于 AsyncStorage 临时引擎 + 内存热索引）。
 * 验证行级 upsert 去重、增量合并、区间查询、热索引命中、跨标的/跨周期隔离。
 */
import { database, resetDatabase } from '@/db';
import { KlineDatabase } from '@/db/KlineDatabase';
import { AsyncStorageKlineAdapter } from '@/db/AsyncStorageKlineAdapter';
import type { Candle, KlinePeriod, Symbol } from '@/api';

const SYM: Symbol = { exchange: 'SH', code: '600519' };
const PERIOD: KlinePeriod = 'day';

function candle(ts: number, close: number): Candle {
  return { datetime: ts, open: close, high: close, low: close, close, volume: 1000 };
}

function makeDb(): KlineDatabase {
  return new KlineDatabase(new AsyncStorageKlineAdapter());
}

describe('KlineDatabase 行级存储', () => {
  beforeEach(() => {
    resetDatabase();
    // 清空 AsyncStorage 单测 store
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    AsyncStorage.__reset?.();
  });

  it('upsert 同 ts 去重覆盖，不重复计数', async () => {
    const db = makeDb();
    await db.saveCandles(SYM, PERIOD, [candle(1, 10), candle(2, 20)]);
    // 再次 upsert ts=2 的新值，应覆盖而非新增
    await db.saveCandles(SYM, PERIOD, [candle(2, 99)]);
    const rows = await db.getCandles(SYM, PERIOD);
    expect(rows).toHaveLength(2);
    expect(rows[1].close).toBe(99);
    expect(await db.count()).toBe(2);
  });

  it('增量合并：只写新根也能被正确读取', async () => {
    const db = makeDb();
    await db.saveCandles(SYM, PERIOD, [candle(1, 10), candle(2, 20), candle(3, 30)]);
    await db.saveCandles(SYM, PERIOD, [candle(4, 40), candle(5, 50)]);
    const latest = await db.getLatestCandles(SYM, PERIOD, 3);
    expect(latest.map((c) => c.close)).toEqual([30, 40, 50]);
  });

  it('区间查询 getRangeCandles 按时间窗切片', async () => {
    const db = makeDb();
    await db.saveCandles(SYM, PERIOD, [candle(1, 1), candle(2, 2), candle(3, 3), candle(4, 4)]);
    const range = await db.getRangeCandles(SYM, PERIOD, 2, 3);
    expect(range.map((c) => c.close)).toEqual([2, 3]);
  });

  it('跨标的/跨周期相互隔离', async () => {
    const db = makeDb();
    const other: Symbol = { exchange: 'SZ', code: '000001' };
    await db.saveCandles(SYM, PERIOD, [candle(1, 10)]);
    await db.saveCandles(other, 'week', [candle(1, 999)]);
    await db.saveCandles(SYM, 'week', [candle(1, 888)]);
    expect(await db.count()).toBe(3);
    const dayRows = await db.getCandles(SYM, PERIOD);
    expect(dayRows[0].close).toBe(10);
    const weekRows = await db.getCandles(SYM, 'week');
    expect(weekRows[0].close).toBe(888);
  });

  it('热索引命中：第二次读取不再落盘', async () => {
    const adapter = new AsyncStorageKlineAdapter();
    const spy = jest.spyOn(adapter, 'getSeries');
    const db = new KlineDatabase(adapter);
    await db.saveCandles(SYM, PERIOD, [candle(1, 10), candle(2, 20)]);
    spy.mockClear();
    await db.getCandles(SYM, PERIOD); // 第一次：应命中热索引（save 已回填）
    expect(spy).not.toHaveBeenCalled();
  });

  it('prune 清理早于阈值的旧行', async () => {
    const db = makeDb();
    const old = Date.now() - 10 * 24 * 3600 * 1000;
    const fresh = Date.now();
    // 手动构造不同 updatedAt 的行
    const adapter = new AsyncStorageKlineAdapter();
    await adapter.upsert([
      { symbol: 'SH.600519', period: 'day', ts: 1, open: 1, high: 1, low: 1, close: 1, volume: 1, amount: 0, updatedAt: old },
      { symbol: 'SH.600519', period: 'day', ts: 2, open: 2, high: 2, low: 2, close: 2, volume: 1, amount: 0, updatedAt: fresh },
    ]);
    const removed = await db.prune(fresh - 1);
    expect(removed).toBe(1);
    expect(await db.count()).toBe(1);
  });

  it('单例 database() 返回同一实例', () => {
    expect(database()).toBe(database());
  });
});
