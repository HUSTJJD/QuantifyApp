/**
 * 信号存储：内存热缓存 + SQLite trade_signal 表。
 * 行情刷新后由 SignalEngine 算出信号写入；UI 通过 getLatest/getAll 读取。
 */
import { quantStore } from '@/db/QuantStore';
import type { Symbol } from '@/api';
import { toFullCode } from '@/domain';
import type { TradeSignal } from './signals';
import type { StrategyConfig } from './strategies';
import { storage, StorageKeys } from '@/db/storage';

/** 内存热表（避免每次读盘）。 */
const memory = new Map<string, TradeSignal>();

export function saveSignal(sig: TradeSignal): void {
  memory.set(sig.symbolKey, sig);
  void quantStore()
    .upsertSignal({
      symbolKey: sig.symbolKey,
      code: sig.symbol.code,
      exchange: sig.symbol.exchange,
      side: sig.side,
      strength: sig.strength,
      reasons: sig.reasons,
      details: JSON.stringify(sig.contributions ?? []),
      ts: sig.ts,
    })
    .catch(() => {});
}

export function getLatest(symbol: Symbol): TradeSignal | undefined {
  return memory.get(toFullCode(symbol));
}

export async function getAll(): Promise<TradeSignal[]> {
  if (memory.size > 0) return Array.from(memory.values());
  const rows = await quantStore().listSignals();
  const out = rows.map((r) => {
    let contributions: TradeSignal['contributions'] = [];
    try {
      contributions = JSON.parse(r.details) as TradeSignal['contributions'];
    } catch {
      contributions = [];
    }
    const sig: TradeSignal = {
      symbol: { code: r.code, exchange: r.exchange as Symbol['exchange'] },
      symbolKey: r.symbolKey,
      side: r.side as TradeSignal['side'],
      strength: r.strength,
      reasons: r.reasons,
      contributions,
      ts: r.ts,
    };
    memory.set(sig.symbolKey, sig);
    return sig;
  });
  return out;
}

/** 加载并合并用户的策略开关配置（与默认值合并）。 */
export async function loadStrategyConfig(): Promise<StrategyConfig> {
  // 信号聚合配置体量小，仍走 KV（非核心行情数据）
  const saved = await storage.getObject<StrategyConfig>(StorageKeys.SIGNAL_CONFIG);
  return saved ?? { enabled: {} };
}

export async function saveStrategyConfig(cfg: StrategyConfig): Promise<void> {
  await storage.setObject(StorageKeys.SIGNAL_CONFIG, cfg);
}

/** 清空全部信号（调试用）。 */
export function clearSignals(): void {
  memory.clear();
}
