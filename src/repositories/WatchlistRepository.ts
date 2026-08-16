/**
 * 自选股仓储（客户端本地持久化）。
 *
 * 本 App 没有后端，自选股等用户数据都保存在客户端存储里。
 * 这里封装 CRUD，业务层只依赖本仓储，不直接碰 storage。
 */
import { storage, StorageKeys } from '@/storage';
import type { Symbol } from '@/api';

const DEFAULT_WATCH: Symbol[] = [
  { code: '600519', exchange: 'SH', name: '贵州茅台' },
  { code: '000858', exchange: 'SZ', name: '五粮液' },
  { code: '00700', exchange: 'HK', name: '腾讯控股' },
];

export async function getWatchlist(): Promise<Symbol[]> {
  const saved = await storage.getObject<Symbol[]>(StorageKeys.WATCHLIST);
  return saved ?? DEFAULT_WATCH;
}

export async function addToWatchlist(symbol: Symbol): Promise<Symbol[]> {
  const list = await getWatchlist();
  const exists = list.some(
    (s) => s.code === symbol.code && s.exchange === symbol.exchange,
  );
  if (exists) return list;
  const next = [...list, symbol];
  await storage.setObject(StorageKeys.WATCHLIST, next);
  return next;
}

export async function removeFromWatchlist(symbol: Symbol): Promise<Symbol[]> {
  const list = await getWatchlist();
  const next = list.filter(
    (s) => !(s.code === symbol.code && s.exchange === symbol.exchange),
  );
  await storage.setObject(StorageKeys.WATCHLIST, next);
  return next;
}

export async function setWatchlist(list: Symbol[]): Promise<void> {
  await storage.setObject(StorageKeys.WATCHLIST, list);
}
