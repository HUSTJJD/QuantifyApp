/**
 * 行情快照本地缓存层。
 *
 * 解决「打开自选股等行情每次都要 loading 好几秒」的问题：
 *  - 首次拉取后按 symbols 维度缓存（sorted key，顺序无关）；
 *  - useQuotes 先秒显缓存（离线/快速首屏），再后台刷新写回；
 *  - 带过期清理（pruneExpired）：超过 TTL 的条目物理删除，避免无限堆积。
 *
 * 行情为实时数据，缓存仅作「上一次快照」用于即时渲染，网络返回后自然覆盖。
 */
import { storage, StorageKeys } from '@/storage';
import type { Quote, Symbol } from '@/api';

const CACHE_VERSION = 1;

interface QuoteCacheEntry {
  version: number;
  updatedAt: number;
  quotes: Quote[];
}

function keyOf(symbols: Symbol[]): string {
  const k = symbols
    .map((s) => `${s.exchange}.${s.code}`)
    .sort()
    .join(',');
  return `${StorageKeys.QUOTE_CACHE_PREFIX}${k}`;
}

export const QuotesCache = {
  /** 读取缓存；版本不符或不存在返回 null */
  async get(symbols: Symbol[]): Promise<Quote[] | null> {
    if (symbols.length === 0) return null;
    const entry = await storage.getObject<QuoteCacheEntry>(keyOf(symbols));
    if (!entry || entry.version !== CACHE_VERSION) return null;
    return entry.quotes;
  },

  /** 写回缓存（空数据不写） */
  async save(symbols: Symbol[], quotes: Quote[]): Promise<void> {
    if (symbols.length === 0 || quotes.length === 0) return;
    const entry: QuoteCacheEntry = { version: CACHE_VERSION, updatedAt: Date.now(), quotes };
    await storage.setObject<QuoteCacheEntry>(keyOf(symbols), entry);
  },

  /**
   * 过期物理清理：删除版本不符或 updatedAt 超过 ttlMs 的条目。返回清理条数。
   * App 启动 / 进入后台时调用一次即可。
   */
  async pruneExpired(ttlMs: number, now: number = Date.now()): Promise<number> {
    const keys = await storage.getKeysByPrefix(StorageKeys.QUOTE_CACHE_PREFIX);
    let removed = 0;
    for (const k of keys) {
      const e = await storage.getObject<QuoteCacheEntry>(k);
      if (!e || e.version !== CACHE_VERSION || now - (e.updatedAt ?? 0) > ttlMs) {
        await storage.remove(k);
        removed += 1;
      }
    }
    return removed;
  },
};
