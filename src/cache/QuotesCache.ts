/**
 * 行情快照本地缓存层（落 SQLite quote_snapshot 领域表）。
 *
 * 与 K 线 + 复权因子同一原则：按列建模，不整包 JSON。
 * useQuotes 先秒显缓存，再后台刷新写回。
 */
import { domainCache } from '@/db/DomainCache';
import type { Quote, Symbol } from '@/api';

/** 行情快照缓存最大有效年龄（默认 1 天）。 */
export const QUOTES_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const QuotesCache = {
  /** 读取缓存；无命中或已过期则返回 null。 */
  async get(symbols: Symbol[], _maxAgeMs?: number): Promise<Quote[] | null> {
    if (symbols.length === 0) return null;
    const map = await domainCache().getQuotes(symbols);
    if (map.size === 0) return null;
    return symbols
      .map((s) => map.get(`${s.exchange}.${s.code}`))
      .filter((q): q is Quote => q != null);
  },

  /** 写回缓存（空数据不写） */
  async save(symbols: Symbol[], quotes: Quote[]): Promise<void> {
    if (symbols.length === 0 || quotes.length === 0) return;
    await domainCache().putQuotes(quotes, QUOTES_MAX_AGE_MS);
  },

  /** 过期物理清理（只清 quote_snapshot，不扫其它领域表）。 */
  async pruneExpired(_ttlMs: number, now: number = Date.now()): Promise<number> {
    return domainCache().pruneQuoteSnapshot(now);
  },
};
