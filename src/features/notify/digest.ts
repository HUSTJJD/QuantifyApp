/**
 * 盘后摘要：聚合扫描命中 / 可操作信号 / 模拟成交，生成标题与正文。
 * 纯计算，便于单测；触达层见 localDigest.ts。
 */
import { quantStore } from '@/data/db/QuantStore';
import { getAll as getAllSignals } from '@/quant/SignalStore';
import { buildCandidatePool, filterActionableSignals } from '@/quant/candidatePool';
import { SimAccountRepo } from '@/simulation';

export interface DigestContent {
  title: string;
  body: string;
  hits: number;
  pool: number;
  signals: number;
  trades: number;
}

export async function buildDigest(): Promise<DigestContent> {
  let hits = 0;
  let pool = 0;
  let signals = 0;
  let trades = 0;
  try {
    const store = quantStore();
    const snaps = await store.listScanSnapshots(1);
    if (snaps.length > 0) {
      const snap = snaps[0];
      hits = snap.hitCount ?? 0;
      const hitRows = await store.listScanHits(snap.id!);
      const poolItems = buildCandidatePool(hitRows);
      pool = poolItems.length;
      const all = await getAllSignals();
      signals = filterActionableSignals(all, poolItems).length;
    }
  } catch {
    // ignore
  }
  try {
    const acc = await SimAccountRepo.get();
    trades = acc.trades.length;
  } catch {
    // ignore
  }

  const parts = [
    hits > 0 ? `扫描命中 ${hits}` : null,
    pool > 0 ? `候选 ${pool}` : null,
    signals > 0 ? `可操作信号 ${signals}` : null,
    trades > 0 ? `模拟成交 ${trades}` : null,
  ].filter(Boolean) as string[];

  return {
    title: '今日盘后摘要',
    body: parts.length > 0 ? parts.join(' · ') : '今日暂无扫描/信号更新，打开 App 查看详情',
    hits,
    pool,
    signals,
    trades,
  };
}

/** 今日是否已发过摘要（按上海时区日切） */
export function digestDayKey(ts = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(ts);
}
