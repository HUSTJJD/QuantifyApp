/**
 * useMarketData —— 业务层使用 API 的 React Hook 封装。
 * 把异步 loading / error / data 三态管理收敛到这里，feature 组件直接消费。
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { marketData } from '@/data/api';
import { isTradingNow } from '@/utils/trading';
import { QuotesCache, QUOTES_MAX_AGE_MS } from '@/data/cache/QuotesCache';
import { logger } from '@/utils/logger';
import { database } from '@/data/db';
import type { Candle, KlineParams, KlinePeriod, Quote, Symbol } from '@/data/api';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useQuotes(
  symbols: Symbol[],
  kind: 'stock' | 'index' = 'stock',
  /** 页面是否可见（tab/路由 focus）。false 时暂停轮询与自动刷新，避免后台页持续发请求 */
  active = true,
): AsyncState<Quote[]> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<Quote[]>>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(symbols);

  // 交易时段内自动轮询刷新行情；非交易/后台不打扰（收盘快照本就不变）。
  // 注：时区错误会导致 isTradingNow 长期 false，从而永不自动刷新——已在 utils/trading 修复为按中国时区计算。
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (isTradingNow()) setTick((t) => t + 1);
    }, 15_000);
    return () => clearInterval(timer);
  }, [active]);

  // 切回前台时强制刷新一次：避免跨日停留在同一屏时一直显示旧缓存（即使非交易时段也触发重拉快照）。
  useEffect(() => {
    if (!active) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setTick((t) => t + 1);
    });
    return () => sub.remove();
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const parsed: Symbol[] = JSON.parse(key);
    if (parsed.length === 0) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    // 1) 先秒显本地缓存（避免每次进入都 loading 好几秒），不等网络。
    //    传入 TTL：超过最大年龄的缓存视为过期，返回 null → 不秒显旧数据，直接进入后台刷新。
    QuotesCache.get(parsed, QUOTES_MAX_AGE_MS).then((cached) => {
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
  }, [key, tick, kind, active]);

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
    const { symbol, period } = parsed;
    const db = database();

    // 1) 先读本地缓存秒显（不等网络）：取最近 count 根作为初始展示，
    //    已追溯过的更早历史仍留在库里，左滑时由 loadEarlier 命中缓存。
    db.getLatestCandles(symbol, period, parsed.count).then((cached) => {
      if (alive && cached.length > 0) {
        setState((s) => ({ ...s, data: cached, loading: false, error: null }));
      }
    });

    // 2) 后台拉最新 count 根，成功后落盘（按 ts 去重合并进全量历史），
    //    再从库中回读「最近 count 根」作为权威展示。
    logger.debug('useKline', '拉取K线', { symbol, period, count: parsed.count });
    marketData
      .getKline(parsed)
      .then(async (data) => {
        if (!alive) return;
        if (data && data.length > 0) await db.saveCandles(symbol, period, data);
        const merged = await db.getLatestCandles(symbol, period, parsed.count);
        if (alive && merged.length > 0) {
          setState({ data: merged, loading: false, error: null });
        } else if (alive) {
          setState({ data: data ?? [], loading: false, error: null });
        }
      })
      .catch((e) => {
        if (!alive) return;
        logger.error('useKline', '拉取K线失败', {
          symbol: `${parsed.symbol.code}.${parsed.symbol.exchange}`,
          period: parsed.period,
          count: parsed.count,
          message: String(e?.message ?? e),
        });
        // 有缓存则保留缓存显示，仅在有错误且无数据时提示
        setState((s) => ({ ...s, loading: false, error: s.data ? null : String(e?.message ?? e) }));
      });
    return () => {
      alive = false;
    };
  }, [key, tick]);

  const loadEarlier = useCallback(async (): Promise<boolean> => {
    const parsed: KlineParams = JSON.parse(key);
    if (!state.data || state.data.length === 0) return false;
    const earliest = state.data[0];
    const earliestMs = new Date(earliest.datetime).getTime();
    if (!Number.isFinite(earliestMs)) return false;
    const db = database();

    // 1) 缓存优先：库里若有早于当前最早时间的历史（上次追溯过 / 离线可用），直接 prepend，不请求网络
    const cachedEarlier = await db.getRangeCandles(symbolOf(parsed), periodOf(parsed), undefined, earliestMs - 1);
    if (cachedEarlier.length > 0) {
      logger.debug('useKline', '[loadEarlier] 命中本地缓存', { cachedCount: cachedEarlier.length });
      setState((s) => ({ ...s, data: mergeKlineChrono(cachedEarlier, s.data ?? []) }));
      return true;
    }

    // 2) 缓存用完 → 向接口拉更早的一页（以当前最早一根为结束时间，向前翻 count 根）
    logger.debug('useKline', '[loadEarlier] 触发网络分页', {
      symbol: parsed.symbol,
      period: parsed.period,
      curCount: state.data.length,
      earliestDate: earliest.datetime,
      endMs: earliestMs,
      count: parsed.count ?? 240,
    });
    const earlier = await marketData.getKline({
      ...parsed,
      endMs: earliestMs,
      count: parsed.count ?? 240,
    });
    if (!earlier || earlier.length === 0) {
      logger.debug('useKline', '[loadEarlier] 返回 false（接口无数据，已到最早）');
      return false;
    }
    // 早于当前最早时间的才算新数据（接口通常包含 endMs 当天，需去重）
    const fresh = earlier.filter((c) => new Date(c.datetime).getTime() < earliestMs);
    logger.debug('useKline', '[loadEarlier] 接口去重后', { freshLen: fresh.length });
    if (fresh.length === 0) {
      logger.debug('useKline', '[loadEarlier] 返回 false（无更早新数据，已到最早）');
      return false;
    }
    // 3) 落盘（按 ts 去重合并），追溯数据长期保存在本地
    await db.saveCandles(symbolOf(parsed), periodOf(parsed), fresh);
    setState((s) => ({ ...s, data: mergeKlineChrono(fresh, s.data ?? []) }));
    logger.debug('useKline', '[loadEarlier] 返回 true（已 prepend 并落盘）');
    return true;
  }, [key, state.data]);

  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []), loadEarlier };
}

/** 从 KlineParams 中提取 symbol（供 loadEarlier 使用） */
function symbolOf(p: KlineParams): Symbol {
  return p.symbol;
}
/** 从 KlineParams 中提取 period */
function periodOf(p: KlineParams): KlinePeriod {
  return p.period;
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
