/**
 * useSyncStatus —— 本地量化库状态与同步控制 Hook（设置页/扫描页用）。
 *
 * 提供：
 *  - stats：标的库数量 / K 线行数 / 复权因子数 / 已同步标的数；
 *  - running / progress：后台同步是否进行中 + 进度；
 *  - triggerSync()：手动触发一轮全市场增量同步（syncDaily）。
 */
import { useCallback, useEffect, useState } from 'react';
import { database } from '@/db';
import { MarketMetaStore } from '@/db/MarketMetaStore';
import { runBackgroundSync } from '@/sync/scheduler';
import type { SyncProgress } from '@/sync/MarketSync';

export interface LocalDbStats {
  tickers: number;
  klineRows: number;
  factors: number;
  synced: number;
}

/**
 * 统计本地库规模（SQLite 或内存回落引擎）。
 * 一律走 COUNT 系方法：全市场几千标的时，拉全表再在 JS 里数长度会把设置页卡住。
 */
async function collectStats(): Promise<LocalDbStats> {
  const store = new MarketMetaStore();
  try {
    const [tickers, klineRows, factors, synced] = await Promise.all([
      store.countTickers(),
      database().count(),
      store.countFactors(),
      store.countSyncedSymbols(),
    ]);
    return { tickers, klineRows, factors, synced };
  } catch {
    return { tickers: 0, klineRows: 0, factors: 0, synced: 0 };
  }
}

export function useSyncStatus() {
  const [stats, setStats] = useState<LocalDbStats>({ tickers: 0, klineRows: 0, factors: 0, synced: 0 });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number>(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshStats = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    collectStats().then((s) => {
      if (alive) setStats(s);
    });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const triggerSync = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setProgress(null);
    try {
      // 手动触发：force=true 跳过“当天已同步”限流，保证用户主动同步总是生效
      await runBackgroundSync((p) => setProgress(p), true);
      setLastSyncAt(Date.now());
    } finally {
      setRunning(false);
      refreshStats();
    }
  }, [running, refreshStats]);

  return { stats, running, progress, lastSyncAt, triggerSync, refreshStats };
}
