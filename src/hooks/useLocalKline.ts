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
        setState({ data: local.slice(-count), loading: false, error: null });
        return;
      }
      // 2) 本地无数据：回退网络（一次性，不落库）
      try {
        const net = await getCandlesFallback(symbol, period, adjust, count);
        if (alive) {
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


