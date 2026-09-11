/**
 * useKline 本地缓存接入测试：
 *  - 挂载时缓存秒显（不等网络）
 *  - 网络刷新结果落盘并合并展示
 *  - loadEarlier 命中本地缓存优先（追溯数据离线可用）；缓存用完才请求网络并落盘
 */
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { useKline } from '@/hooks/useMarketData';
import { marketData } from '@/data/api';
import { database, resetDatabase } from '@/data/db';
import type { Candle, KlineParams, Symbol } from '@/data/api';

const SYM: Symbol = { code: '600519', exchange: 'SH', name: '茅台' };
const PERIOD = 'day';

function c(ts: number, close: number): Candle {
  return { datetime: ts, open: close, high: close, low: close, close, volume: 1000, amount: 0 };
}

type Hook = ReturnType<typeof useKline>;
let captured: Hook;

function Probe({ params }: { params: KlineParams }): React.JSX.Element {
  captured = useKline(params);
  return <></>;
}

/** 在 act 内 flush 微任务队列（useKline 的异步 effect） */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(() => resolve()));
  await new Promise<void>((resolve) => setImmediate(() => resolve()));
}

describe('useKline 本地缓存接入', () => {
  let tree: ReactTestRenderer;

  beforeEach(() => {
    resetDatabase();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    AsyncStorage.__reset?.();
    // 确保每个用例从干净的数据库开始
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // unmount 会触发 React 状态更新，必须包在 act 内，否则 afterEach 打出 not wrapped in act 警告
    if (tree) {
      act(() => {
        tree.unmount();
      });
      tree = undefined as unknown as ReactTestRenderer;
    }
  });

  it('挂载时缓存秒显，网络刷新后落盘合并', async () => {
    // 预置本地缓存 2 根
    const db = database();
    await db.saveCandles(SYM, PERIOD, [c(1, 10), c(2, 20)]);

    // 网络返回 1 根更新（ts=3 新增）
    const spy = jest.spyOn(marketData, 'getKline').mockResolvedValue([c(2, 20), c(3, 30)]);

    await act(async () => {
      tree = create(<Probe params={{ symbol: SYM, period: PERIOD, count: 5 }} />);
      await flush();
    });

    // 展示 = 缓存 2 根 + 网络新增 1 根合并
    expect(captured.loading).toBe(false);
    expect(captured.data?.map((x) => x.close)).toEqual([10, 20, 30]);
    // 网络结果已落盘：数据库存有 3 根
    expect(await db.getCandles(SYM, PERIOD)).toHaveLength(3);
    expect(spy).toHaveBeenCalled();
  });

  it('网络失败但有缓存时保留缓存展示，error 为空', async () => {
    await database().saveCandles(SYM, PERIOD, [c(1, 10)]);
    jest.spyOn(marketData, 'getKline').mockRejectedValue(new Error('network down'));

    await act(async () => {
      tree = create(<Probe params={{ symbol: SYM, period: PERIOD, count: 5 }} />);
      await flush();
    });

    expect(captured.data?.map((x) => x.close)).toEqual([10]);
    expect(captured.error).toBeNull();
    expect(captured.loading).toBe(false);
  });

  it('loadEarlier 命中本地缓存（追溯数据离线可用，不请求网络）', async () => {
    const db = database();
    // 本地已有完整追溯历史（前 5 根早于当前展示的最近 2 根）
    await db.saveCandles(SYM, PERIOD, [c(1, 10), c(2, 20), c(3, 30), c(4, 40), c(5, 50)]);

    const spy = jest.spyOn(marketData, 'getKline').mockResolvedValue([]); // 不应被调用
    await act(async () => {
      tree = create(<Probe params={{ symbol: SYM, period: PERIOD, count: 2 }} />);
      await flush();
    });
    // 初始展示最近 2 根
    expect(captured.data?.map((x) => x.close)).toEqual([40, 50]);

    // 清掉「挂载时网络刷新」的调用记录，单独验证 loadEarlier 不请求网络
    spy.mockClear();
    let result: boolean | null = null;
    await act(async () => {
      result = await captured.loadEarlier();
    });
    // 命中缓存：直接 prepend 出全部历史，不请求网络
    expect(result).toBe(true);
    expect(captured.data?.map((x) => x.close)).toEqual([10, 20, 30, 40, 50]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('loadEarlier 缓存用完时请求网络并落盘', async () => {
    const db = database();
    // 本地只有最近 2 根（无更早历史）
    await db.saveCandles(SYM, PERIOD, [c(4, 40), c(5, 50)]);

    // 接口返回更早的 2 根
    const spy = jest
      .spyOn(marketData, 'getKline')
      .mockImplementation(async (p: KlineParams) => (p.endMs ? [c(2, 20), c(3, 30), c(4, 40)] : []));

    await act(async () => {
      tree = create(<Probe params={{ symbol: SYM, period: PERIOD, count: 2 }} />);
      await flush();
    });

    let result: boolean | null = null;
    await act(async () => {
      result = await captured.loadEarlier();
    });

    expect(result).toBe(true);
    // 展示 = 缓存2根 + 网络更早2根（去重 endMs 当天）
    expect(captured.data?.map((x) => x.close)).toEqual([20, 30, 40, 50]);
    // 已落盘：数据库现在有 4 根
    expect(await db.getCandles(SYM, PERIOD)).toHaveLength(4);
    expect(spy).toHaveBeenCalled();
  });
});
