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

/** 行情快照缓存最大有效年龄（默认 1 天）。超过则视为过期，get 返回 null 触发重新拉取。 */
export const QUOTES_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
  /**
   * 读取缓存；版本不符、不存在或（当传入 maxAgeMs 时）已超过最大年龄则返回 null。
   * 过期返回 null 可让调用方走 loading 并触发一次后台刷新，避免界面永远停在旧快照。
   */
  async get(symbols: Symbol[], maxAgeMs?: number): Promise<Quote[] | null> {
    if (symbols.length === 0) return null;
    const entry = await storage.getObject<QuoteCacheEntry>(keyOf(symbols));
    if (!entry || entry.version !== CACHE_VERSION) return null;
    if (maxAgeMs != null && Date.now() - (entry.updatedAt ?? 0) > maxAgeMs) return null;
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
