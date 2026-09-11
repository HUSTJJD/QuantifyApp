/**
 * 资产/持仓仓储（客户端本地持久化）。
 *
 * 本 App 没有后端，用户持仓与资产快照都保存在客户端存储里。
 * 提供持仓的增删改查与资产快照记录，业务层只依赖本仓储。
 *
 * 持久化由 src/db/UserStore 承接：真机走本地 SQLite 库，
 * jest / 未接入原生环境自动回落 AsyncStorage（键名不变，平滑升级）。
 */
import { userStore } from '@/db/UserStore';
import type { Holding, AssetSnapshot } from '@/db/UserStore';

export type { Holding, AssetSnapshot };
export type { Symbol } from '@/api';

export async function getHoldings(): Promise<Holding[]> {
  return userStore.getHoldings();
}

export async function setHoldings(list: Holding[]): Promise<void> {
  await userStore.setHoldings(list);
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

export async function removeHolding(symbol: Holding['symbol']): Promise<Holding[]> {
  const list = await getHoldings();
  const next = list.filter(
    (x) => !(x.symbol.code === symbol.code && x.symbol.exchange === symbol.exchange),
  );
  await setHoldings(next);
  return next;
}

export async function getSnapshots(): Promise<AssetSnapshot[]> {
  return userStore.getSnapshots();
}

export async function addSnapshot(snap: AssetSnapshot): Promise<void> {
  await userStore.addSnapshot(snap);
}
