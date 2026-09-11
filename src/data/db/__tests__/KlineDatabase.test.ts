/**
 * K 线区间删除（deleteRange / deleteCandlesInRange）单测。
 * 用内存版 AsyncStorage 替换原生模块；每个用例使用独立 symbol，避免共享存储串扰。
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      store,
      getItem: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
      setItem: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      removeItem: jest.fn(async (k: string) => {
        store.delete(k);
      }),
      getAllKeys: jest.fn(async () => Array.from(store.keys())),
    },
  };
});

import type { Candle, KlinePeriod, Symbol } from '@/data/api';
import { AsyncStorageKlineAdapter } from '../AsyncStorageKlineAdapter';
import { KlineDatabase } from '../KlineDatabase';
import type { KlineRow } from '../KlineSchema';
import { symbolKey } from '../KlineSchema';

const PERIOD: KlinePeriod = 'day';

// 每个用例独立 symbol，避免共享内存存储串扰
const SYM_A: Symbol = { code: '600001', exchange: 'SH' };
const SYM_B: Symbol = { code: '600002', exchange: 'SH' };
const SYM_C: Symbol = { code: '600003', exchange: 'SH' };
const SYM_D: Symbol = { code: '600004', exchange: 'SH' };

function candles(from: number, to: number): Candle[] {
  const out: Candle[] = [];
  for (let ts = from; ts <= to; ts += 1) {
    out.push({ datetime: ts, open: 1, high: 1, low: 1, close: 1, volume: 1 });
  }
  return out;
}

function rows(sym: Symbol, from: number, to: number): KlineRow[] {
  const sk = symbolKey(sym);
  const out: KlineRow[] = [];
  for (let ts = from; ts <= to; ts += 1) {
    out.push({
      symbol: sk,
      period: PERIOD,
      ts,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
      amount: 0,
      updatedAt: ts,
    });
  }
  return out;
}

describe('KlineDatabase.deleteCandlesInRange（门面 + 热索引失效）', () => {
  it('删除 [4,6] 后仅移除区间内 3 根，区间外保留', async () => {
    const db = new KlineDatabase(new AsyncStorageKlineAdapter());
    await db.saveCandles(SYM_A, PERIOD, candles(1, 10));
    expect((await db.getCandles(SYM_A, PERIOD)).length).toBe(10);

    const removed = await db.deleteCandlesInRange(SYM_A, PERIOD, 4, 6);
    expect(removed).toBe(3);

    const after = await db.getCandles(SYM_A, PERIOD);
    expect(after.map((c) => Number(c.datetime))).toEqual([1, 2, 3, 7, 8, 9, 10]);
  });

  it('删除后热索引失效，读取反映落盘真实数据（非缓存旧值）', async () => {
    const db = new KlineDatabase(new AsyncStorageKlineAdapter());
    await db.saveCandles(SYM_B, PERIOD, candles(1, 5));
    await db.getCandles(SYM_B, PERIOD); // 预热热索引
    await db.deleteCandlesInRange(SYM_B, PERIOD, 2, 4);
    const after = await db.getCandles(SYM_B, PERIOD);
    expect(after.map((c) => Number(c.datetime))).toEqual([1, 5]);
  });
});

describe('AsyncStorageKlineAdapter.deleteRange（适配器直接验证）', () => {
  it('仅删除区间内的行', async () => {
    const a = new AsyncStorageKlineAdapter();
    await a.upsert(rows(SYM_C, 1, 10));
    const removed = await a.deleteRange(SYM_C, PERIOD, 4, 6);
    expect(removed).toBe(3);
    const series = await a.getSeries(SYM_C, PERIOD);
    expect(series.map((r) => r.ts)).toEqual([1, 2, 3, 7, 8, 9, 10]);
  });

  it('区间内无数据返回 0', async () => {
    const a = new AsyncStorageKlineAdapter();
    await a.upsert(rows(SYM_D, 1, 3));
    expect(await a.deleteRange(SYM_D, PERIOD, 100, 200)).toBe(0);
  });
});
