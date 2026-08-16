/**
 * 资产/持仓仓储（客户端本地持久化）。
 *
 * 本 App 没有后端，用户持仓与资产快照都保存在客户端存储里。
 * 提供持仓的增删改查与资产快照记录，业务层只依赖本仓储。
 */
import { storage } from '@/storage';
import type { Symbol } from '@/api';

export interface Holding {
  symbol: Symbol;
  /** 持仓数量（股） */
  shares: number;
  /** 成本价 */
  costPrice: number;
}

export interface AssetSnapshot {
  /** 时间戳（ms） */
  ts: number;
  /** 总资产（元） */
  total: number;
}

const HOLDINGS_KEY = 'app.portfolio.holdings';
const SNAPSHOTS_KEY = 'app.portfolio.snapshots';

export async function getHoldings(): Promise<Holding[]> {
  return (await storage.getObject<Holding[]>(HOLDINGS_KEY)) ?? [];
}

export async function setHoldings(list: Holding[]): Promise<void> {
  await storage.setObject(HOLDINGS_KEY, list);
}

export async function upsertHolding(h: Holding): Promise<Holding[]> {
  const list = await getHoldings();
  const idx = list.findIndex(
    (x) => x.symbol.code === h.symbol.code && x.symbol.exchange === h.symbol.exchange,
  );
  if (idx >= 0) list[idx] = h;
  else list.push(h);
  await setHoldings(list);
  return list;
}

export async function removeHolding(symbol: Symbol): Promise<Holding[]> {
  const list = await getHoldings();
  const next = list.filter(
    (x) => !(x.symbol.code === symbol.code && x.symbol.exchange === symbol.exchange),
  );
  await setHoldings(next);
  return next;
}

export async function getSnapshots(): Promise<AssetSnapshot[]> {
  return (await storage.getObject<AssetSnapshot[]>(SNAPSHOTS_KEY)) ?? [];
}

export async function addSnapshot(snap: AssetSnapshot): Promise<void> {
  const list = await getSnapshots();
  list.push(snap);
  // 仅保留最近 90 条，避免无限增长
  const trimmed = list.slice(-90);
  await storage.setObject(SNAPSHOTS_KEY, trimmed);
}
