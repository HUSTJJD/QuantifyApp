/**
 * 信号存储：内存热缓存 + SQLite trade_signal。
 * 键 = profileId|symbolKey；UI 可按标的取最强信号或按档案取全部。
 */
import { quantStore } from '@/data/db/QuantStore';
import type { Symbol } from '@/data/api';
import type { TradeSignal } from '@/domain';
import { toFullCode } from '@/domain';

const memory = new Map<string, TradeSignal>();

function keyOf(profileId: string, symbolKey: string): string {
  return `${profileId}|${symbolKey}`;
}

export function saveSignal(sig: TradeSignal): void {
  memory.set(keyOf(sig.profileId, sig.symbolKey), sig);
  quantStore()
    .upsertSignal({
      symbolKey: keyOf(sig.profileId, sig.symbolKey),
      code: sig.symbol.code,
      exchange: sig.symbol.exchange,
      side: sig.side,
      strength: sig.strength,
      reasons: sig.reasons,
      details: JSON.stringify({
        profileId: sig.profileId,
        profileName: sig.profileName,
        contributions: sig.contributions ?? [],
      }),
      ts: sig.ts,
    })
    .catch(() => {});
}

export function getForSymbol(symbol: Symbol): TradeSignal[] {
  const k = toFullCode(symbol);
  return [...memory.values()].filter((s) => s.symbolKey === k);
}

export function getLatest(symbol: Symbol): TradeSignal | undefined {
  const list = getForSymbol(symbol);
  if (list.length === 0) return undefined;
  return list.reduce((a, b) => (Math.abs(b.strength) > Math.abs(a.strength) ? b : a));
}

export async function getAll(): Promise<TradeSignal[]> {
  if (memory.size > 0) return [...memory.values()];
  const rows = await quantStore().listSignals();
  const out: TradeSignal[] = [];
  for (const r of rows) {
    const parts = String(r.symbolKey).split('|');
    if (parts.length < 2) continue;
    const profileId = parts[0];
    const symbolKey = parts.slice(1).join('|');
    let profileName = profileId;
    let contributions: TradeSignal['contributions'] = [];
    try {
      const d = JSON.parse(r.details) as {
        profileName?: string;
        contributions?: TradeSignal['contributions'];
      };
      profileName = d.profileName ?? profileId;
      contributions = d.contributions ?? [];
    } catch {
      // ignore
    }
    const [exchange, code] = symbolKey.split('.');
    const sig: TradeSignal = {
      symbol: { code: code ?? r.code, exchange: (exchange || r.exchange) as Symbol['exchange'] },
      symbolKey,
      side: r.side as TradeSignal['side'],
      strength: r.strength,
      profileId,
      profileName,
      reasons: r.reasons,
      contributions,
      ts: r.ts,
    };
    memory.set(keyOf(profileId, symbolKey), sig);
    out.push(sig);
  }
  return out;
}

export function clearSignals(): void {
  memory.clear();
}
