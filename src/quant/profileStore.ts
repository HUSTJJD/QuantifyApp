/**
 * 策略档案仓储。
 *  - 持久化到 SQLite strategy_profile 表；
 *  - 首次启动（无存档）时按内置模板播种；
 *  - 每次变更同步写一份「全局信号聚合配置」（KV，SignalEngine 读取）。
 */
import { quantStore } from '@/db/QuantStore';
import { storage, StorageKeys } from '@/db/storage';
import { STRATEGIES } from './strategies';
import { createProfileFromTemplate, type StrategyProfile } from './profile';

function toRow(p: StrategyProfile) {
  return {
    id: p.id,
    templateId: p.templateId,
    name: p.name,
    note: p.note ?? '',
    enabled: p.enabled,
    autoTrade: p.autoTrade,
    params: p.params ?? {},
    selection: p.selection as unknown as Record<string, unknown>,
    exitRules: p.exit as unknown as Record<string, unknown>,
    tradeRules: p.trade as unknown as Record<string, unknown>,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function fromRow(r: {
  id: string; templateId: string; name: string; note: string;
  enabled: boolean; autoTrade: boolean;
  params: Record<string, number>;
  selection: Record<string, unknown>;
  exitRules: Record<string, unknown>;
  tradeRules: Record<string, unknown>;
  createdAt: number; updatedAt: number;
}): StrategyProfile {
  return {
    id: r.id,
    templateId: r.templateId,
    name: r.name,
    note: r.note,
    enabled: r.enabled,
    autoTrade: r.autoTrade,
    params: r.params,
    selection: r.selection as unknown as StrategyProfile['selection'],
    exit: r.exitRules as unknown as StrategyProfile['exit'],
    trade: r.tradeRules as unknown as StrategyProfile['trade'],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** 读所有档案；无存档时播种默认（内置模板各一个）。 */
export async function getProfiles(): Promise<StrategyProfile[]> {
  const rows = await quantStore().listProfiles();
  if (rows.length > 0) return rows.map(fromRow);
  const seeded = STRATEGIES.map((s) => createProfileFromTemplate(s.id));
  await saveProfiles(seeded);
  return seeded;
}

export async function getProfile(id: string): Promise<StrategyProfile | undefined> {
  const row = await quantStore().getProfile(id);
  return row ? fromRow(row) : undefined;
}

/** 全量覆盖保存（并发时以最后一次调用为准）。 */
export async function saveProfiles(profiles: StrategyProfile[]): Promise<void> {
  const now = Date.now();
  const store = quantStore();
  const list = profiles.map((p) => (p.updatedAt ? p : { ...p, updatedAt: now }));
  for (const p of list) {
    await store.upsertProfile(toRow(p));
  }
  await syncSignalConfig(list);
}

/** 新增/更新单个档案。 */
export async function upsertProfile(p: StrategyProfile): Promise<StrategyProfile[]> {
  const list = await getProfiles();
  const i = list.findIndex((x) => x.id === p.id);
  const merged = { ...p, updatedAt: Date.now() };
  const next = i >= 0 ? list.map((x) => (x.id === p.id ? merged : x)) : [...list, merged];
  await saveProfiles(next);
  return next;
}

export async function deleteProfile(id: string): Promise<StrategyProfile[]> {
  await quantStore().deleteProfile(id);
  const next = (await getProfiles()).filter((p) => p.id !== id);
  await syncSignalConfig(next);
  return next;
}

/**
 * 同步旧版全局信号聚合配置（SignalEngine 每 tick 读取）。
 * 约定：同模板只允许一个档案，故可直接按 templateId 映射 enabled/params。
 */
async function syncSignalConfig(profiles: StrategyProfile[]): Promise<void> {
  const enabled: Record<string, boolean> = {};
  const params: Record<string, Record<string, number>> = {};
  for (const p of profiles) {
    enabled[p.templateId] = p.enabled;
    if (p.params && Object.keys(p.params).length > 0) params[p.templateId] = p.params;
  }
  await storage.setObject(StorageKeys.SIGNAL_CONFIG, { enabled, params });
}
