/**
 * 策略档案仓储。SQLite strategy_profile；无存档时按内置模板播种。
 * 档案模型以 legs[] 为准（无 templateId 列、无信号内核同步）。
 */
import { quantStore } from '@/data/db/QuantStore';
import { seedProfilesFromTemplates, type CombineMode, type StrategyLeg, type StrategyProfile } from './profile';

interface ProfileRow {
  id: string;
  name: string;
  note: string;
  enabled: boolean;
  autoTrade: boolean;
  /** { legs, combineMode } */
  params: unknown;
  selection: Record<string, unknown>;
  exitRules: Record<string, unknown>;
  tradeRules: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

function toRow(p: StrategyProfile): ProfileRow {
  return {
    id: p.id,
    name: p.name,
    note: p.note ?? '',
    enabled: p.enabled,
    autoTrade: p.autoTrade,
    params: { legs: p.legs, combineMode: p.combineMode },
    selection: p.selection as unknown as Record<string, unknown>,
    exitRules: p.exit as unknown as Record<string, unknown>,
    tradeRules: p.trade as unknown as Record<string, unknown>,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function fromRow(r: ProfileRow): StrategyProfile {
  const raw = (r.params ?? {}) as { legs?: StrategyLeg[]; combineMode?: CombineMode };
  const legs = Array.isArray(raw.legs) ? raw.legs : [];
  return {
    id: r.id,
    name: r.name,
    note: r.note,
    enabled: r.enabled,
    autoTrade: r.autoTrade,
    legs,
    combineMode: raw.combineMode ?? 'and',
    selection: r.selection as unknown as StrategyProfile['selection'],
    exit: r.exitRules as unknown as StrategyProfile['exit'],
    trade: r.tradeRules as unknown as StrategyProfile['trade'],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function getProfiles(): Promise<StrategyProfile[]> {
  const rows = await quantStore().listProfiles();
  if (rows.length > 0) return rows.map((r) => fromRow(r as unknown as ProfileRow));
  const seeded = seedProfilesFromTemplates();
  await saveProfiles(seeded);
  return seeded;
}

export async function getProfile(id: string): Promise<StrategyProfile | undefined> {
  const row = await quantStore().getProfile(id);
  return row ? fromRow(row as unknown as ProfileRow) : undefined;
}

export async function saveProfiles(profiles: StrategyProfile[]): Promise<void> {
  const now = Date.now();
  const store = quantStore();
  for (const p of profiles) {
    const row = toRow(p.updatedAt ? p : { ...p, updatedAt: now });
    await store.upsertProfile(row as never);
  }
}

export async function upsertProfile(p: StrategyProfile): Promise<StrategyProfile[]> {
  const list = await getProfiles();
  const merged = { ...p, updatedAt: Date.now() };
  const next = list.some((x) => x.id === p.id)
    ? list.map((x) => (x.id === p.id ? merged : x))
    : [...list, merged];
  await saveProfiles([merged]);
  return next;
}

export async function deleteProfile(id: string): Promise<void> {
  await quantStore().deleteProfile(id);
}
