/**
 * useLocalKline —— 基于本地库的 K 线 Hook（本地聚合周/月 + 复权计算）。
 *
 * 与 useKline 的分工：
 *  - useKline      ：拉网络数据 + 落库（日 K 不复权入库），秒显缓存；
 *  - useLocalKline ：读本地日 K（不复权）→ 按 period 聚合（周/月）→ 按 adjust 复权。
 *                    适用于个股详情页「本地自算周期 + 复权切换」场景。
 *
 * 数据流：本地无日 K 时回退网络（一次性拉取，不落库），保证首次打开也有数据。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCandlesLocal, getCandlesFallback } from '@/data/db/KlineReader';
import type { AdjustMode } from '@/quant/adjustment';
import type { Candle, KlinePeriod, Symbol } from '@/data/api';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useLocalKline(
  symbol: Symbol,
  period: KlinePeriod,
  adjust: AdjustMode,
  count = 500,
): AsyncState<Candle[]> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<Candle[]>>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      // 1) 本地优先：读不复权日 K → 聚合 → 复权
      const local = await getCandlesLocal(symbol, period, adjust);
      if (alive && local && local.length > 0) {
        // TODO(debug): 临时周/月 K 数据探针，定位后移除
        if (period !== 'day') debugKline('local', symbol, period, adjust, local.slice(-count));
        setState({ data: local.slice(-count), loading: false, error: null });
        return;
      }
      // 2) 本地无数据：回退网络（一次性，不落库）
      try {
        const net = await getCandlesFallback(symbol, period, adjust, count);
        if (alive) {
          if (period !== 'day') debugKline('net', symbol, period, adjust, net);
          setState({ data: net, loading: false, error: null });
        }
      } catch (e) {
        if (alive) setState({ data: null, loading: false, error: String(e instanceof Error ? e.message : e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [symbol, period, adjust, count, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  // 让 reload 触发本地库重读
  useEffect(() => {
    if (tick === 0) return;
    (async () => {
      const local = await getCandlesLocal(symbol, period, adjust);
      if (aliveRef.current && local && local.length > 0) {
        setState({ data: local.slice(-count), loading: false, error: null });
      }
    })();
  }, [tick, symbol, period, adjust, count]);

  return { ...state, reload };
}

/** TODO(debug): 临时探针 —— 打印周/月 K 数据概要，用于定位指数周线闪退。定位后删除。 */
function debugKline(
  from: 'local' | 'net',
  symbol: Symbol,
  period: KlinePeriod,
  adjust: AdjustMode,
  candles: Candle[],
): void {
  try {
    const n = candles.length;
    let bad = 0;
    let badDateTime = 0;
    const badIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const ts = new Date(c.datetime).getTime();
      if (!Number.isFinite(ts)) { badDateTime++; if (badIdx.length < 5) badIdx.push(i); }
      const nums = [c.open, c.high, c.low, c.close, c.volume, c.amount];
      for (const v of nums) {
        if (typeof v !== 'number' || (!Number.isFinite(v) && v !== undefined)) { bad++; if (badIdx.length < 5) badIdx.push(i); }
      }
    }
    const head = candles.slice(0, 3);
    const tail = candles.slice(-3);
    const sample = (arr: Candle[]) =>
      arr.map((c) => ({ dt: c.datetime, o: c.open, h: c.high, l: c.low, cl: c.close, v: c.volume, a: c.amount }));
    console.warn(
      `[kline-debug] ${from} ${symbol.code}.${symbol.exchange} ${period} adjust=${adjust} ` +
        `n=${n} badNonFinite=${bad} badDateTime=${badDateTime} badIdx=${JSON.stringify(badIdx)} ` +
        `head=${JSON.stringify(sample(head))} tail=${JSON.stringify(sample(tail))}`,
    );
  } catch (e) {
    console.warn(`[kline-debug] error: ${String(e)}`);
  }
}


