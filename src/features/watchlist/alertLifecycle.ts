/**
 * 告警生命周期与命中冷却（OpenStock + streetmerchant）。
 */
import { storage } from '@/data/db/storage';

export type AlertRuleStatus = 'active' | 'triggered' | 'expired' | 'disabled';

export interface AlertLifecycle {
  ruleId: string;
  symbolKey: string;
  status: AlertRuleStatus;
  triggeredAt?: number;
  expiresAt?: number;
  lastNotifiedAt?: number;
  cooldownSec?: number;
}

const LIFE_KEY = 'alert.lifecycle.v1';
const DEFAULT_COOLDOWN_SEC = 300;
const DEFAULT_EXPIRES_DAYS = 90;

export async function getLifecycleMap(): Promise<Record<string, AlertLifecycle>> {
  const saved = await storage.getObject<Record<string, AlertLifecycle>>(LIFE_KEY);
  return saved && typeof saved === 'object' ? saved : {};
}

export async function saveLifecycleMap(map: Record<string, AlertLifecycle>): Promise<void> {
  await storage.setObject(LIFE_KEY, map);
}

function lifeKey(ruleId: string, symbolKey: string): string {
  return `${ruleId}::${symbolKey}`;
}

export async function ensureLifecycle(
  ruleId: string,
  symbolKey: string,
  opts?: { cooldownSec?: number },
): Promise<AlertLifecycle> {
  const map = await getLifecycleMap();
  const k = lifeKey(ruleId, symbolKey);
  const cur = map[k];
  if (cur && cur.status !== 'expired') return cur;
  const now = Date.now();
  const life: AlertLifecycle = {
    ruleId,
    symbolKey,
    status: 'active',
    expiresAt: now + DEFAULT_EXPIRES_DAYS * 24 * 3600_000,
    cooldownSec: opts?.cooldownSec ?? DEFAULT_COOLDOWN_SEC,
  };
  map[k] = life;
  await saveLifecycleMap(map);
  return life;
}

/** 是否在冷却/过期/已停用而应跳过 notify */
export async function shouldSkipNotify(ruleId: string, symbolKey: string): Promise<boolean> {
  const map = await getLifecycleMap();
  const life = map[lifeKey(ruleId, symbolKey)];
  if (!life) return false;
  if (life.status === 'expired' || life.status === 'disabled') return true;
  if (life.expiresAt && Date.now() > life.expiresAt) {
    life.status = 'expired';
    map[lifeKey(ruleId, symbolKey)] = life;
    await saveLifecycleMap(map);
    return true;
  }
  if (life.lastNotifiedAt) {
    const cool = (life.cooldownSec ?? DEFAULT_COOLDOWN_SEC) * 1000;
    if (Date.now() - life.lastNotifiedAt < cool) return true;
  }
  return false;
}

export async function markNotified(ruleId: string, symbolKey: string): Promise<void> {
  const map = await getLifecycleMap();
  const k = lifeKey(ruleId, symbolKey);
  const now = Date.now();
  const prev = map[k];
  map[k] = {
    ...(prev ?? { ruleId, symbolKey, cooldownSec: DEFAULT_COOLDOWN_SEC }),
    status: 'triggered',
    triggeredAt: now,
    lastNotifiedAt: now,
    expiresAt: prev?.expiresAt ?? now + DEFAULT_EXPIRES_DAYS * 24 * 3600_000,
  };
  await saveLifecycleMap(map);
}

export async function listLifecycle(): Promise<AlertLifecycle[]> {
  const map = await getLifecycleMap();
  return Object.values(map).sort((a, b) => (b.triggeredAt ?? 0) - (a.triggeredAt ?? 0));
}

export async function reenableLifecycle(ruleId: string, symbolKey: string): Promise<void> {
  const map = await getLifecycleMap();
  const k = lifeKey(ruleId, symbolKey);
  if (map[k]) {
    map[k] = { ...map[k], status: 'active' };
    await saveLifecycleMap(map);
  }
}

/** 指数退避状态（per source id） */
export interface BackoffState {
  fails: number;
  nextDelayMs: number;
  updatedAt: number;
}

const BACKOFF_KEY = 'poll.backoff.v1';
const BASE_MS = 15_000;
const MAX_MS = 60_000;

export async function getBackoff(sourceId: string): Promise<number> {
  const map = await storage.getObject<Record<string, BackoffState>>(BACKOFF_KEY);
  const st = map?.[sourceId];
  if (!st) return BASE_MS;
  return Math.min(MAX_MS, Math.max(BASE_MS, st.nextDelayMs || BASE_MS));
}

export async function recordBackoffFailure(sourceId: string): Promise<void> {
  const map = (await storage.getObject<Record<string, BackoffState>>(BACKOFF_KEY)) ?? {};
  const prev = map[sourceId];
  const fails = (prev?.fails ?? 0) + 1;
  const nextDelayMs = Math.min(MAX_MS, BASE_MS * Math.pow(2, Math.min(fails, 3)));
  map[sourceId] = { fails, nextDelayMs, updatedAt: Date.now() };
  await storage.setObject(BACKOFF_KEY, map);
}

export async function recordBackoffSuccess(sourceId: string): Promise<void> {
  const map = (await storage.getObject<Record<string, BackoffState>>(BACKOFF_KEY)) ?? {};
  const prev = map[sourceId];
  if (!prev) return;
  map[sourceId] = {
    fails: 0,
    nextDelayMs: Math.max(BASE_MS, Math.floor((prev.nextDelayMs || BASE_MS) / 2)),
    updatedAt: Date.now(),
  };
  await storage.setObject(BACKOFF_KEY, map);
}
