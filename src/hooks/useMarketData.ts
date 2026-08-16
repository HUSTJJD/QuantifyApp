/**
 * useMarketData —— 业务层使用 API 的 React Hook 封装。
 * 把异步 loading / error / data 三态管理收敛到这里，feature 组件直接消费。
 */
import { useCallback, useEffect, useState } from 'react';
import { marketData } from '@/api';
import { isTradingNow } from '@/utils/trading';
import { QuotesCache } from '@/cache/QuotesCache';
import { logger } from '@/utils/logger';
import type { Candle, KlineParams, Quote, Symbol } from '@/api';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useQuotes(
  symbols: Symbol[],
  kind: 'stock' | 'index' = 'stock',
): AsyncState<Quote[]> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<Quote[]>>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(symbols);

  // 交易时段内自动轮询刷新行情；非交易时段（含周末/节假日）不打扰，显示上一交易日收盘快照。
  useEffect(() => {
    const timer = setInterval(() => {
      if (isTradingNow()) setTick((t) => t + 1);
    }, 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    const parsed: Symbol[] = JSON.parse(key);
    if (parsed.length === 0) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    // 1) 先秒显本地缓存（避免每次进入都 loading 好几秒），不等网络
    QuotesCache.get(parsed).then((cached) => {
      if (alive && cached) setState({ data: cached, loading: false, error: null });
    });
    // 2) 后台拉取最新行情，成功后写回缓存并刷新 UI（失败保留缓存）
    const fetchFn = kind === 'index' ? marketData.getIndexQuotes(parsed) : marketData.getQuotes(parsed);
    logger.debug('useQuotes', '拉取行情', {
      kind,
      symbols: parsed.map((s) => `${s.code}.${s.exchange}`),
    });
    fetchFn
      .then((data) => {
        if (!alive) return;
        logger.debug('useQuotes', '行情返回', { count: data?.length ?? 0, sample: data?.[0] });
        QuotesCache.save(parsed, data);
        setState({ data, loading: false, error: null });
      })
      .catch((e) => {
        if (!alive) return;
        logger.error('useQuotes', '行情失败', { message: String(e?.message ?? e) });
        // 有缓存则保留缓存显示，仅在有错误且无数据时提示
        setState((s) => ({ ...s, loading: false, error: s.data ? null : String(e?.message ?? e) }));
      });
    return () => {
      alive = false;
    };
  }, [key, tick, kind]);

  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) };
}

export function useKline(params: KlineParams): AsyncState<Candle[]> & {
  reload: () => void;
  /** 向前分页加载更早历史（无限左滑到上市首日）。返回是否还有更早数据。 */
  loadEarlier: () => Promise<boolean>;
} {
  const [state, setState] = useState<AsyncState<Candle[]>>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(params);

  useEffect(() => {
    let alive = true;
    const parsed: KlineParams = JSON.parse(key);
    setState((s) => ({ ...s, loading: true }));
    marketData
      .getKline(parsed)
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((e) => alive && setState({ data: null, loading: false, error: String(e?.message ?? e) }));
    return () => {
      alive = false;
    };
  }, [key, tick]);

  const loadEarlier = useCallback(async (): Promise<boolean> => {
    const parsed: KlineParams = JSON.parse(key);
    if (!state.data || state.data.length === 0) return false;
    // 以当前最早一根的时间为结束时间，向前翻 count 根
    const earliest = state.data[0];
    const endMs = new Date(earliest.datetime).getTime();
    logger.debug('useKline', '[loadEarlier] 触发', {
      symbol: parsed.symbol,
      period: parsed.period,
      curCount: state.data.length,
      earliestDate: earliest.datetime,
      endMs,
      count: parsed.count ?? 240,
    });
    if (!Number.isFinite(endMs)) return false;
    const earlier = await marketData.getKline({
      ...parsed,
      endMs,
      count: parsed.count ?? 240,
    });
    logger.debug('useKline', '[loadEarlier] 接口返回', {
      rawLen: earlier?.length ?? 0,
      rawFirst: earlier?.[0]?.datetime,
      rawLast: earlier?.[earlier.length - 1]?.datetime,
    });
    if (!earlier || earlier.length === 0) {
      logger.debug('useKline', '[loadEarlier] 返回 false（接口无数据，已到最早）');
      return false;
    }
    // 早于当前最早时间的才算新数据（腾讯接口通常包含 endMs 当天，需去重）
    const earliestTime = endMs;
    const fresh = earlier.filter((c) => new Date(c.datetime).getTime() < earliestTime);
    logger.debug('useKline', '[loadEarlier] 去重后', {
      freshLen: fresh.length,
      freshFirst: fresh[0]?.datetime,
      freshLast: fresh[fresh.length - 1]?.datetime,
    });
    if (fresh.length === 0) {
      logger.debug('useKline', '[loadEarlier] 返回 false（无更早新数据，已到最早）');
      return false;
    }
    setState((s) => ({
      ...s,
      data: mergeKlineChrono(fresh, s.data ?? []),
    }));
    logger.debug('useKline', '[loadEarlier] 返回 true（已 prepend，还有更多）');
    return true;
  }, [key, state.data]);

  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []), loadEarlier };
}

/** 把更早的 K 线按时间升序合并到现有数据前（去重，升序） */
function mergeKlineChrono(earlier: Candle[], current: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  const push = (c: Candle) => {
    const t = new Date(c.datetime).getTime();
    if (!map.has(t)) map.set(t, c);
  };
  earlier.forEach(push);
  current.forEach(push);
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime(),
  );
}
