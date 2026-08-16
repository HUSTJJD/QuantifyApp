/**
 * 策略档案仓储。
 *  - 持久化 StrategyProfile[] 到 AsyncStorage；
 *  - 首次启动（无存档）时按内置模板播种；
 *  - 每次变更同步写一份「全局信号聚合配置」（SIGNAL_CONFIG 兼容层），
 *    让 SignalEngine/自选页的聚合买卖信号继续跟随策略启用状态与参数。
 */
import { storage, StorageKeys } from '@/db/storage';
import { STRATEGIES } from './strategies';
import { createProfileFromTemplate, type StrategyProfile } from './profile';

const KEY = StorageKeys.STRATEGY_PROFILES;
const SIGNAL_CFG_KEY = StorageKeys.SIGNAL_CONFIG;

/** 读所有档案；无存档时播种默认（内置模板各一个）。 */
export async function getProfiles(): Promise<StrategyProfile[]> {
  const saved = await storage.getObject<StrategyProfile[]>(KEY);
  if (saved && saved.length > 0) return saved;
  const seeded = STRATEGIES.map((s) => createProfileFromTemplate(s.id));
  await saveProfiles(seeded);
  return seeded;
}

export async function getProfile(id: string): Promise<StrategyProfile | undefined> {
  const ps = await getProfiles();
  return ps.find((p) => p.id === id);
}

/** 全量覆盖保存（并发时以最后一次调用为准）。 */
export async function saveProfiles(profiles: StrategyProfile[]): Promise<void> {
  const now = Date.now();
  const list = profiles.map((p) => (p.updatedAt ? p : { ...p, updatedAt: now }));
  await storage.setObject(KEY, list);
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
  const next = (await getProfiles()).filter((p) => p.id !== id);
  await saveProfiles(next);
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
  await storage.setObject(SIGNAL_CFG_KEY, { enabled, params });
}
