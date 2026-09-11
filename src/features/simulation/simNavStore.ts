/** 模拟盘净值快照（与真实资产快照分键） */
import { storage } from '@/data/db/storage';

export interface SimNavPoint {
  ts: number;
  total: number;
}

const KEY = 'sim.nav.snapshots.v1';

export async function getSimSnapshots(): Promise<SimNavPoint[]> {
  const saved = await storage.getObject<SimNavPoint[]>(KEY);
  return Array.isArray(saved) ? saved : [];
}

export async function addSimSnapshot(point: SimNavPoint): Promise<void> {
  const list = await getSimSnapshots();
  const dayKey = (ts: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(ts);
  const today = dayKey(point.ts);
  const filtered = list.filter((s) => dayKey(s.ts) !== today);
  filtered.push(point);
  filtered.sort((a, b) => a.ts - b.ts);
  await storage.setObject(KEY, filtered.slice(-400));
}

export async function resetSimSnapshots(): Promise<void> {
  await storage.setObject(KEY, []);
}
