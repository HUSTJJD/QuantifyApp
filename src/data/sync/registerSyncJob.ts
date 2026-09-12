/**
 * 把全市场同步注册为统一调度 job（quant-loop-polish）。
 * 启动时 import 本模块即可；真正的延迟启动仍走 scheduleBackgroundSync。
 */
import { registerJobKind, type ScheduledJob, type JobRun } from '@/quant/scheduler';
import { runBackgroundSync } from './scheduler';

registerJobKind('market_sync', async (_job: ScheduledJob, _run: JobRun) => {
  await runBackgroundSync(undefined, true);
  return { summary: '全市场增量同步完成' };
});
