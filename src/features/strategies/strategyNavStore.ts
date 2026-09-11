/**
 * 策略专属模拟盘净值快照（按 profileId 分键，与全局模拟盘快照隔离）。
 * 同日多次进入只保留最后一次，最多 400 点。
 */
import { storage } from '@/data/db/storage';

export interface StrategyNavPoint {
  ts: number;
  total: number;
}

function keyOf(profileId: string): string {
  return `strategy.nav.snapshots.v1.${profileId}`;
}

export async function getStrategySnapshots(profileId: string): Promise<StrategyNavPoint[]> {
  const saved = await storage.getObject<StrategyNavPoint[]>(keyOf(profileId));
  return Array.isArray(saved) ? saved : [];
}

export async function addStrategySnapshot(profileId: string, point: StrategyNavPoint): Promise<void> {
  const list = await getStrategySnapshots(profileId);
  const dayKey = (ts: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(ts);
  const today = dayKey(point.ts);
  const filtered = list.filter((s) => dayKey(s.ts) !== today);
  filtered.push(point);
  filtered.sort((a, b) => a.ts - b.ts);
  await storage.setObject(keyOf(profileId), filtered.slice(-400));
}

export async function resetStrategySnapshots(profileId: string): Promise<void> {
  await storage.setObject(keyOf(profileId), []);
}
