/**
 * useKlineChart —— 多市场 K 线数据 Hook（借鉴 useKlineData）。
 * 能力：防抖、请求去重、TTL 缓存、向前翻页、按市场交易时段自动刷新。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candle, Symbol } from '@/data/api';
import type { ChartMarket, ChartPeriod, ChartAdjust, KlineDataProvider, AutoRefreshConfig } from '@/chart/types';
import { isTimelinePeriod } from '@/chart/types';
import { createDefaultKlineProvider, chartMarketOf, loadEarlierKline } from '@/chart/dataProvider';
import { isMarketTradingTime } from '@/chart/marketSessions';

const DEFAULT_DEBOUNCE_MS = 120;
const DEFAULT_TTL_MS = 30_000;
const DEFAULT_LOAD_MORE = 180;

interface CacheEntry {
  data: Candle[];
  at: number;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<Candle[]>>();

function cacheKey(symbol: Symbol, market: ChartMarket, period: ChartPeriod, adjust: ChartAdjust): string {
  return `${symbol.exchange}.${symbol.code}|${market}|${period}|${adjust}`;
}

function timeOf(c: Candle): number {
  return typeof c.datetime === 'number' ? c.datetime : new Date(c.datetime).getTime();
}

function mergeCandles(old: Candle[], next: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const c of [...old, ...next]) map.set(timeOf(c), c);
  return Array.from(map.values()).sort((a, b) => timeOf(a) - timeOf(b));
}

export interface UseKlineChartParams {
  symbol: Symbol;
  period?: ChartPeriod;
  adjust?: ChartAdjust;
  /** 缺省由 symbol.exchange 推断 */
  market?: ChartMarket;
  dataProvider?: KlineDataProvider;
  /** 请求条数，默认 180 */
  count?: number;
  debounceMs?: number;
  ttlMs?: number;
  autoRefresh?: boolean | AutoRefreshConfig;
  enabled?: boolean;
}

export interface UseKlineChartResult {
  candles: Candle[];
  timeline: Candle[];
  prevClose: number | null;
  loading: boolean;
  loadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  market: ChartMarket;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

export function useKlineChart(params: UseKlineChartParams): UseKlineChartResult {
  const {
    symbol,
    period = 'day',
    adjust = 'none',
    market: marketProp,
    dataProvider,
    count = DEFAULT_LOAD_MORE,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    ttlMs = DEFAULT_TTL_MS,
    autoRefresh = false,
    enabled = true,
  } = params;

  const market = marketProp ?? chartMarketOf(symbol);
  const providerRef = useRef<KlineDataProvider>(dataProvider ?? createDefaultKlineProvider());
  providerRef.current = dataProvider ?? providerRef.current;

  const key = cacheKey(symbol, market, period, adjust);
  const [candles, setCandles] = useState<Candle[]>(() => cache.get(key)?.data ?? []);
  const [timeline, setTimeline] = useState<Candle[]>([]);
  const [prevClose, setPrevClose] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchMain = useCallback(
    async (force = false) => {
      if (!enabled) return;
      const hit = cache.get(key);
      if (!force && hit && Date.now() - hit.at < ttlMs) {
        setCandles(hit.data);
        return;
      }
      // 去重
      const inflight = pending.get(key);
      if (!force && inflight) {
        setLoading(true);
        try {
          const data = await inflight;
          if (mounted.current) setCandles(data);
        } finally {
          if (mounted.current) setLoading(false);
        }
        return;
      }
      setLoading(true);
      setError(null);
      const p = (async () => {
        if (isTimelinePeriod(period)) {
          const res = await providerRef.current.getTimeline?.({ symbol, market, period: period as 'timeline' });
          const data = res?.data ?? [];
          if (mounted.current) {
            setTimeline(data);
            setPrevClose(res?.prevClose ?? null);
            setCandles(data);
          }
          cache.set(key, { data, at: Date.now() });
          return data;
        }
        const data = await providerRef.current.getKline({ symbol, market, period, adjust, limit: count });
        cache.set(key, { data, at: Date.now() });
        if (mounted.current) setCandles(data);
        return data;
      })();
      pending.set(key, p);
      try {
        await p;
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        pending.delete(key);
        if (mounted.current) setLoading(false);
      }
    },
    [enabled, key, symbol, market, period, adjust, count, ttlMs],
  );

  // 防抖拉取
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      fetchMain(false).catch(() => undefined);
    }, debounceMs);
    return () => clearTimeout(t);
  }, [enabled, key, debounceMs, fetchMain]);

  // 自动刷新（按市场时段）
  useEffect(() => {
    if (!enabled || !autoRefresh) return;
    const cfg = typeof autoRefresh === 'object' ? autoRefresh : { intervalMs: 15_000, onlyTradingTime: true };
    const interval = cfg.intervalMs ?? 15_000;
    const onlyTrading = cfg.onlyTradingTime !== false;
    const timer = setInterval(() => {
      if (onlyTrading && !isMarketTradingTime(market)) return;
      fetchMain(true).catch(() => undefined);
    }, interval);
    return () => clearInterval(timer);
  }, [enabled, autoRefresh, market, fetchMain]);

  const loadMore = useCallback(async () => {
    if (isTimelinePeriod(period) || loadingMore || candles.length === 0) return;
    const earliest = candles[0];
    if (!earliest) return;
    setLoadingMore(true);
    try {
      const older = await loadEarlierKline(providerRef.current, {
        symbol,
        market,
        period,
        adjust,
        earliestMs: timeOf(earliest),
        limit: count,
      });
      if (!mounted.current) return;
      if (!older || older.length === 0) {
        setHasMore(false);
        return;
      }
      const merged = mergeCandles(candles, older);
      setCandles(merged);
      cache.set(key, { data: merged, at: Date.now() });
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (mounted.current) setLoadingMore(false);
    }
  }, [candles, key, loadingMore, market, period, adjust, count, symbol]);

  const refresh = useCallback(async () => {
    await fetchMain(true);
  }, [fetchMain]);

  return {
    candles,
    timeline: isTimelinePeriod(period) ? candles : timeline,
    prevClose,
    loading,
    loadingMore,
    error,
    hasMore,
    market,
    refresh,
    loadMore,
  };
}

/** 测试/调试：清空 K 线内存缓存 */
export function clearKlineChartCache(): void {
  cache.clear();
  pending.clear();
}
