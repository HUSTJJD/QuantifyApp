/**
 * 本地任务调度内核（对齐 Opptrix packages/schedule）。
 * 业务注册 kind → executor；runner 负责防重入、run 历史、nextRun 计算。
 */
import { storage } from '@/data/db/storage';
import { computeNextRunAt, type ScheduleKind, type ScheduleSpec } from './nextRun';

export type JobKind =
  | 'digest'
  | 'eod_scan'
  | 'market_sync'
  | 'alert_poll'
  | 'strategy_tick'
  | (string & {});

export type JobNotifyMode = 'default' | 'silent' | 'on_ok' | 'on_error' | 'all';

export interface ScheduledJob {
  id: string;
  kind: JobKind;
  title: string;
  enabled: boolean;
  scheduleKind: ScheduleKind;
  schedule: ScheduleSpec;
  notifyOverride?: JobNotifyMode;
  payload?: Record<string, unknown>;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastStatus?: 'ok' | 'error' | 'running' | null;
}

export interface JobRun {
  id: string;
  jobId: string;
  kind: JobKind;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'ok' | 'error';
  trigger: 'manual' | 'schedule';
  summary?: string;
  error?: string;
}

export type JobExecutor = (
  job: ScheduledJob,
  run: JobRun,
) => Promise<{ summary?: string } | void>;

const JOBS_KEY = 'sched.jobs.v1';
const RUNS_KEY = 'sched.runs.v1';
const MAX_RUNS = 200;

const executors = new Map<JobKind, JobExecutor>();
const running = new Set<string>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
let notifySink: ((job: ScheduledJob, run: JobRun) => void) | null = null;

export function registerJobKind(kind: JobKind, executor: JobExecutor): void {
  executors.set(kind, executor);
}

export function setJobNotifySink(fn: ((job: ScheduledJob, run: JobRun) => void) | null): void {
  notifySink = fn;
}

export async function listJobs(): Promise<ScheduledJob[]> {
  const saved = await storage.getObject<ScheduledJob[]>(JOBS_KEY);
  return Array.isArray(saved) ? saved : [];
}

export async function saveJobs(jobs: ScheduledJob[]): Promise<void> {
  await storage.setObject(JOBS_KEY, jobs);
}

export async function upsertJob(job: ScheduledJob): Promise<ScheduledJob> {
  const jobs = await listJobs();
  const idx = jobs.findIndex((j) => j.id === job.id);
  const next = computeNextRunAt(job.scheduleKind, job.schedule);
  const full: ScheduledJob = { ...job, nextRunAt: next ? next.toISOString() : null };
  if (idx >= 0) jobs[idx] = full;
  else jobs.push(full);
  await saveJobs(jobs);
  return full;
}

export async function setJobEnabled(id: string, enabled: boolean): Promise<void> {
  const jobs = await listJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx < 0) return;
  jobs[idx] = { ...jobs[idx], enabled };
  if (enabled) {
    const next = computeNextRunAt(jobs[idx].scheduleKind, jobs[idx].schedule);
    jobs[idx].nextRunAt = next ? next.toISOString() : null;
  }
  await saveJobs(jobs);
}

export async function listRuns(limit = 50): Promise<JobRun[]> {
  const saved = await storage.getObject<JobRun[]>(RUNS_KEY);
  return (Array.isArray(saved) ? saved : []).slice(0, limit);
}

export async function listRunsForJob(jobId: string, limit = 10): Promise<JobRun[]> {
  const runs = await listRuns(MAX_RUNS);
  return runs.filter((r) => r.jobId === jobId).slice(0, limit);
}

async function appendRun(run: JobRun): Promise<void> {
  const runs = await listRuns(MAX_RUNS);
  const next = [run, ...runs].slice(0, MAX_RUNS);
  await storage.setObject(RUNS_KEY, next);
}

async function patchRun(runId: string, patch: Partial<JobRun>): Promise<void> {
  const runs = await listRuns(MAX_RUNS);
  const idx = runs.findIndex((r) => r.id === runId);
  if (idx < 0) return;
  runs[idx] = { ...runs[idx], ...patch };
  await storage.setObject(RUNS_KEY, runs);
}

async function patchJob(jobId: string, patch: Partial<ScheduledJob>): Promise<void> {
  const jobs = await listJobs();
  const idx = jobs.findIndex((j) => j.id === jobId);
  if (idx < 0) return;
  jobs[idx] = { ...jobs[idx], ...patch };
  await saveJobs(jobs);
}

export async function runJobNow(jobId: string, trigger: 'manual' | 'schedule' = 'manual'): Promise<JobRun | null> {
  const jobs = await listJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;
  if (running.has(job.id)) return null;
  const executor = executors.get(job.kind);
  if (!executor) return null;

  running.add(job.id);
  const run: JobRun = {
    id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    jobId: job.id,
    kind: job.kind,
    startedAt: new Date().toISOString(),
    status: 'running',
    trigger,
  };
  await appendRun(run);
  await patchJob(job.id, { lastStatus: 'running', lastRunAt: run.startedAt });

  try {
    const result = await executor(job, run);
    const finishedAt = new Date().toISOString();
    const summary = result?.summary;
    const okRun: JobRun = { ...run, status: 'ok', finishedAt, summary };
    await patchRun(run.id, { status: 'ok', finishedAt, summary });
    const next = computeNextRunAt(job.scheduleKind, job.schedule, new Date(finishedAt), {
      afterSuccess: job.scheduleKind === 'once',
    });
    await patchJob(job.id, {
      lastStatus: 'ok',
      lastRunAt: finishedAt,
      nextRunAt: next ? next.toISOString() : null,
    });
    maybeNotify(job, okRun);
    return okRun;
  } catch (e) {
    const finishedAt = new Date().toISOString();
    const error = e instanceof Error ? e.message : String(e);
    await patchRun(run.id, { status: 'error', finishedAt, error });
    const next = computeNextRunAt(job.scheduleKind, job.schedule, new Date(finishedAt));
    await patchJob(job.id, {
      lastStatus: 'error',
      lastRunAt: finishedAt,
      nextRunAt: next ? next.toISOString() : null,
    });
    maybeNotify(job, { ...run, status: 'error', finishedAt, error });
    return { ...run, status: 'error', finishedAt, error };
  } finally {
    running.delete(job.id);
  }
}

function maybeNotify(job: ScheduledJob, run: JobRun): void {
  const mode = job.notifyOverride ?? 'default';
  if (mode === 'silent') return;
  const ok = run.status === 'ok';
  if (mode === 'on_ok' && !ok) return;
  if (mode === 'on_error' && ok) return;
  notifySink?.(job, run);
}

/** 扫描到期任务并执行（前台 tick / 前台恢复时调用）。 */
export async function tickScheduler(now = new Date()): Promise<number> {
  const jobs = await listJobs();
  let fired = 0;
  for (const job of jobs) {
    if (!job.enabled) continue;
    if (running.has(job.id)) continue;
    const due =
      !job.nextRunAt ||
      new Date(job.nextRunAt).getTime() <= now.getTime() ||
      (job.scheduleKind === 'cron' &&
        job.schedule.expression &&
        isCronDueToday(job.schedule.expression, now));
    if (!due) continue;
    // interval/cron：先推 next 再跑，避免 tick 连打
    if (job.scheduleKind !== 'once') {
      const next = computeNextRunAt(job.scheduleKind, job.schedule, now);
      await patchJob(job.id, { nextRunAt: next ? next.toISOString() : null });
    }
    await runJobNow(job.id, 'schedule');
    fired += 1;
  }
  return fired;
}

function isCronDueToday(expression: string, now: Date): boolean {
  // 宽松：若 nextRunAt 已过期则由 tick 处理；此处仅作兜底
  return false;
}

export function startSchedulerTicker(intervalMs = 30_000): void {
  stopSchedulerTicker();
  void tickScheduler().catch(() => undefined);
  tickTimer = setInterval(() => {
    void tickScheduler().catch(() => undefined);
  }, intervalMs);
}

export function stopSchedulerTicker(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

/** 内置默认任务（幂等 upsert） */
export async function ensureDefaultJobs(): Promise<void> {
  const existing = await listJobs();
  const have = new Set(existing.map((j) => j.kind));
  if (!have.has('digest')) {
    await upsertJob({
      id: 'job_digest',
      kind: 'digest',
      title: '盘后摘要',
      enabled: false,
      scheduleKind: 'cron',
      schedule: { expression: '10 15 * * 1-5' },
      notifyOverride: 'all',
    });
  }
  if (!have.has('eod_scan')) {
    await upsertJob({
      id: 'job_eod_scan',
      kind: 'eod_scan',
      title: '尾盘扫描',
      enabled: false,
      scheduleKind: 'cron',
      schedule: { expression: '30 14 * * 1-5' },
      notifyOverride: 'on_ok',
      payload: { preset: 'volume_breakout' },
    });
  }
}
