/**
 * 信号存储：内存热缓存 + AsyncStorage 持久化。
 * 行情刷新后由 SignalEngine 算出信号写入；UI 通过 getLatest/getAll 读取。
 */
import { storage, StorageKeys } from '@/storage';
import type { Symbol } from '@/api';
import { toFullCode } from '@/domain';
import type { TradeSignal } from './signals';
import type { StrategyConfig } from './strategies';

const SIGNAL_KEY = (symKey: string) => `${StorageKeys.SIGNAL_PREFIX}${symKey}`;
const SIGNAL_CFG_KEY = StorageKeys.SIGNAL_CONFIG;

/** 内存热表（避免每次读盘）。 */
const memory = new Map<string, TradeSignal>();

export function saveSignal(sig: TradeSignal): void {
  memory.set(sig.symbolKey, sig);
  storage.setObject(SIGNAL_KEY(sig.symbolKey), sig);
}

export function getLatest(symbol: Symbol): TradeSignal | undefined {
  return memory.get(toFullCode(symbol));
}

export async function getAll(): Promise<TradeSignal[]> {
  if (memory.size > 0) return Array.from(memory.values());
  const keys = await storage.getKeysByPrefix(StorageKeys.SIGNAL_PREFIX);
  const out: TradeSignal[] = [];
  for (const k of keys) {
    const s = await storage.getObject<TradeSignal>(k);
    if (s) out.push(s);
  }
  for (const s of out) memory.set(s.symbolKey, s);
  return out;
}

/** 加载并合并用户的策略开关配置（与默认值合并）。 */
export async function loadStrategyConfig(): Promise<StrategyConfig> {
  const saved = await storage.getObject<StrategyConfig>(SIGNAL_CFG_KEY);
  return saved ?? { enabled: {} };
}

export async function saveStrategyConfig(cfg: StrategyConfig): Promise<void> {
  await storage.setObject(SIGNAL_CFG_KEY, cfg);
}

/** 清空全部信号（调试用）。 */
export function clearSignals(): void {
  memory.clear();
}
