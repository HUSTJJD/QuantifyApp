/**
 * 通知扇出（对齐 streetmerchant messaging）。
 * 未配置通道静默跳过；单通道失败不影响其他。
 */
import { storage } from '@/data/db/storage';
import { Alert } from 'react-native';

export type NotifyChannelId = 'inApp' | 'localPush' | 'webhook';

export interface NotifyChannelPrefs {
  inApp: boolean;
  localPush: boolean;
  webhook: boolean;
  webhookUrl: string;
}

export const DEFAULT_CHANNEL_PREFS: NotifyChannelPrefs = {
  inApp: true,
  localPush: false,
  webhook: false,
  webhookUrl: '',
};

const PREFS_KEY = 'notify.channels.v1';

export async function getChannelPrefs(): Promise<NotifyChannelPrefs> {
  const saved = await storage.getObject<Partial<NotifyChannelPrefs>>(PREFS_KEY);
  return { ...DEFAULT_CHANNEL_PREFS, ...(saved ?? {}) };
}

export async function setChannelPrefs(patch: Partial<NotifyChannelPrefs>): Promise<NotifyChannelPrefs> {
  const cur = await getChannelPrefs();
  const next = { ...cur, ...patch };
  await storage.setObject(PREFS_KEY, next);
  return next;
}

export interface NotifyPayload {
  title: string;
  body: string;
  /** 深链路径或路由名，可选 */
  route?: string;
  /** 结构化数据（webhook JSON） */
  data?: Record<string, unknown>;
}

type InAppFn = (payload: NotifyPayload) => void;
type LocalPushFn = (payload: NotifyPayload) => void;

let inAppFn: InAppFn | null = null;
let localPushFn: LocalPushFn | null = null;

export function setInAppNotifier(fn: InAppFn | null): void {
  inAppFn = fn;
}

export function setLocalPushNotifier(fn: LocalPushFn | null): void {
  localPushFn = fn;
}

export async function sendNotify(payload: NotifyPayload): Promise<void> {
  const prefs = await getChannelPrefs();
  if (prefs.inApp && inAppFn) {
    try {
      inAppFn(payload);
    } catch {
      // ignore
    }
  }
  if (prefs.localPush && localPushFn) {
    try {
      localPushFn(payload);
    } catch {
      // ignore
    }
  }
  if (prefs.webhook && prefs.webhookUrl.trim()) {
    try {
      await fetch(prefs.webhookUrl.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: payload.title,
          body: payload.body,
          route: payload.route,
          data: payload.data,
          ts: Date.now(),
        }),
      });
    } catch {
      // ignore network fail
    }
  }
}

/** 设置页试发 */
export async function sendTestNotify(): Promise<void> {
  const prefs = await getChannelPrefs();
  if (!prefs.inApp && !prefs.localPush && !(prefs.webhook && prefs.webhookUrl.trim())) {
    throw new Error('请先启用至少一个通知通道');
  }
  await sendNotify({ title: '通知测试', body: '通道配置可用。', data: { test: true } });
}

/** 兜底：无 AlertCenter 时用系统 Alert */
export function fallbackAlert(payload: NotifyPayload): void {
  Alert.alert(payload.title, payload.body);
}
