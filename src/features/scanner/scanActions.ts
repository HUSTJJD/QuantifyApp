/**
 * 扫描结果的操作辅助（加自选 / 详情跳转 / 持久化 的数据准备）。
 *
 * 纯逻辑拆出便于单测；UI（ScannerScreen）只负责渲染与回调，
 * 通过注入 `add` 回调把"加入自选"的真实落地与逻辑解耦。
 */
import type { Symbol } from '@/data/api';
import type { ScanHit } from '@/quant/scanner';
import { quantStore } from '@/data/db/QuantStore';

/** 命中结果的身份键（与 WatchlistRepository.symbolKey 保持一致：code.exchange） */
export function hitKey(hit: ScanHit): string {
  return `${hit.symbol.code}.${hit.symbol.exchange}`;
}

/** 把命中结果映射为去重后的标的数组（按 code.exchange 去重） */
export function hitsToSymbols(hits: ScanHit[]): Symbol[] {
  const seen = new Set<string>();
  const out: Symbol[] = [];
  for (const h of hits) {
    const key = hitKey(h);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h.symbol);
  }
  return out;
}

/**
 * 批量把扫描命中加入自选。
 * @param hits 扫描结果
 * @param add 加自选回调（注入便于单测；UI 侧传 WatchlistRepository.addToWatchlist，幂等去重）
 * @returns 实际尝试加入的去重标的数量
 */
export async function addHitsToWatchlist(
  hits: ScanHit[],
  add: (s: Symbol) => Promise<unknown>,
): Promise<number> {
  const symbols = hitsToSymbols(hits);
  await Promise.all(symbols.map((s) => add(s)));
  return symbols.length;
}

/**
 * 把一次扫描结果持久化到 scan_snapshot + scan_hit 表。
 * @returns snapshot id（供后续查询候选池）
 */
export async function saveScanSnapshot(
  criteria: Record<string, unknown>,
  hits: ScanHit[],
  total: number,
  durationMs: number,
): Promise<number> {
  const store = quantStore();
  const createdAt = Date.now();
  const snapshotId = await store.saveScanSnapshot(
    {
      criteria: JSON.stringify(criteria),
      total,
      hitCount: hits.length,
      durationMs,
      createdAt,
    },
    hits.map((h) => ({
      code: h.symbol.code,
      exchange: h.symbol.exchange,
      name: h.name || h.symbol.code,
      reasons: h.reasons.join(' · '),
      lastClose: h.lastClose,
      changePct: h.changePct,
      metrics: JSON.stringify(h.metrics),
    })),
  );
  return snapshotId;
}
