/**
 * 盘后摘要调度器。
 * 未引入 expo-notifications 原生模块时，用前台轮询 + 应用内 AlertCenter 触达；
 * 接口与系统推送对齐，后续可无感换成 expo-notifications 本地通知。
 */
import { getAppPrefs } from '@/settings/appPrefs';
import { buildDigest, digestDayKey } from './digest';
import { storage } from '@/data/db/storage';
import { registerJobKind, type ScheduledJob, type JobRun } from '@/quant/scheduler';
import { sendNotify } from './channels';

const LAST_DIGEST_KEY = 'notify.digest.lastDay';

export type DigestSink = (title: string, body: string) => void;

let timer: ReturnType<typeof setInterval> | null = null;
let sink: DigestSink | null = null;

export function setDigestSink(fn: DigestSink): void {
  sink = fn;
}

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(':').map((x) => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return { h: 15, m: 10 };
  return { h: Math.min(23, Math.max(0, h)), m: Math.min(59, Math.max(0, m)) };
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** 是否交易日（周一~五；节假日不做 ICS，近似） */
function isWeekday(d: Date): boolean {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

export async function maybeFireDigestOnce(now = new Date()): Promise<boolean> {
  const prefs = await getAppPrefs();
  if (!prefs.notifyDigest) return false;
  if (!isWeekday(now)) return false;

  const { h, m } = parseHm(prefs.notifyDigestTime);
  const target = h * 60 + m;
  const nowMin = minutesOfDay(now);
  // 触发窗口：到点后 30 分钟内
  if (nowMin < target || nowMin > target + 30) return false;

  const day = digestDayKey(now.getTime());
  const last = await storage.getString(LAST_DIGEST_KEY);
  if (last === day) return false;

  const content = await buildDigest();
  await storage.setString(LAST_DIGEST_KEY, day);
  sink?.(content.title, content.body);
  return true;
}

export function startDigestScheduler(intervalMs = 60_000): void {
  stopDigestScheduler();
  // 启动时先试一次
  void maybeFireDigestOnce().catch(() => undefined);
  timer = setInterval(() => {
    void maybeFireDigestOnce().catch(() => undefined);
  }, intervalMs);
}

export function stopDigestScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** 设置页「立即试发」 */
export async function fireDigestNow(): Promise<{ title: string; body: string }> {
  const content = await buildDigest();
  sink?.(content.title, content.body);
  return content;
}

/** 注册到统一调度器 */
registerJobKind('digest', async (_job: ScheduledJob, _run: JobRun) => {
  const day = digestDayKey();
  const last = await storage.getString(LAST_DIGEST_KEY);
  if (last === day) return { summary: '今日已发送过摘要，跳过' };
  const content = await buildDigest();
  await storage.setString(LAST_DIGEST_KEY, day);
  sink?.(content.title, content.body);
  await sendNotify({ title: content.title, body: content.body, data: { kind: 'digest' } });
  return { summary: content.body };
});
