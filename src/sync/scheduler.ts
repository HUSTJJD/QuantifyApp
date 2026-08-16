/**
 * 全市场增量同步调度器。
 *
 * - scheduleBackgroundSync(delayMs)：App 启动后延迟触发一次 syncDaily；
 *   用模块级 flag 保证单次进程内只触发一轮（避免多入口重复拉起）。
 * - 同一天已完成过一轮全市场同步则跳过（sync_state 写入 '__SYNC_DAILY__' 标记），
 *   避免频繁启动 App 时反复触发 5000+ 标的 × (日 K + 复权因子) 的同步洪峰；
 *   手动同步（设置页）传 force=true 仍强制执行。
 * - 后台同步失败静默（不阻塞 UI），进度走 logger。
 */
import type { KlinePeriod } from '@/api';
import { syncDaily, SyncProgress } from './MarketSync';
import { MarketMetaStore } from '@/db/MarketMetaStore';
import { logger } from '@/utils/logger';

const log = logger.withScope('SyncScheduler');

/** 全市场日 K 同步的“当天已跑”标记（存于 sync_state） */
export const DAILY_MARKER_SYMBOL = '__SYNC_DAILY__';
export const DAILY_MARKER_PERIOD: KlinePeriod = 'day';

let scheduled = false;
let running = false;

function sameCalendarDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

/** 启动后延迟执行一轮全市场增量同步（默认 5 秒后，避开启动期网络抢占） */
export function scheduleBackgroundSync(delayMs = 5000, onProgress?: (p: SyncProgress) => void): void {
  if (scheduled) return;
  scheduled = true;
  // jest 环境跳过真实同步（避免悬挂 timer 导致 worker 泄漏）
  if (process.env.NODE_ENV === 'test' || typeof jest !== 'undefined') return;
  setTimeout(() => {
    runBackgroundSync(onProgress).catch(() => undefined);
  }, delayMs);
}

/**
 * 立即执行一轮（幂等：已在跑则跳过）。
 * @param force 手动强制：跳过“当天已同步”的节流判断。
 */
export async function runBackgroundSync(onProgress?: (p: SyncProgress) => void, force = false): Promise<void> {
  if (running) return;

  if (!force) {
    // 限流：同一自然日只全市场同步一轮，避免每次打开 App 都触发全市场洪峰
    const meta = new MarketMetaStore();
    const lastRunMs = await meta.getSyncState(DAILY_MARKER_SYMBOL, DAILY_MARKER_PERIOD);
    if (lastRunMs > 0 && sameCalendarDay(lastRunMs, Date.now())) {
      log.info?.('今日已完成全市场同步，跳过后台同步');
      return;
    }
  }

  running = true;
  try {
    log.info?.('后台增量同步开始');
    const res = await syncDaily((p) => {
      // 进度节流：每 50 条打一次日志，避免刷屏
      if (p.done % 50 === 0 || p.done === p.total) {
        log.info?.('同步进度', { done: p.done, total: p.total, skipped: p.skipped, failed: p.failed });
      }
      onProgress?.(p);
    });
    await new MarketMetaStore().setSyncState(DAILY_MARKER_SYMBOL, DAILY_MARKER_PERIOD, Date.now());
    log.info?.('后台增量同步完成', { durationMs: res.durationMs, failed: res.failed, errors: res.errors.slice(0, 3) });
  } catch (e) {
    log.warn?.('后台增量同步失败', e);
  } finally {
    running = false;
  }
}

/** 测试用：重置调度状态 */
export function resetSyncScheduler(): void {
  scheduled = false;
  running = false;
}
