/**
 * 行情快照本地缓存层（落 SQLite quote_snapshot 领域表）。
 *
 * 行情实时性强：缓存只用于秒显与失败回退，TTL 必须短。
 * 旧版 24h 会导致过期价（如港股价停在昨收）长期霸屏。
 */
import { domainCache } from '@/db/DomainCache';
import type { Quote, Symbol } from '@/api';

/** 行情缓存最大有效年龄：60s */
export const QUOTES_MAX_AGE_MS = 60_000;

function isValidQuote(q: Quote | undefined | null): q is Quote {
  return q != null && Number.isFinite(q.last) && q.last !== 0;
}

export const QuotesCache = {
  /** 读取缓存；无命中、过期或 last=0 则返回 null。 */
  async get(symbols: Symbol[], maxAgeMs: number = QUOTES_MAX_AGE_MS): Promise<Quote[] | null> {
    if (symbols.length === 0) return null;
    const map = await domainCache().getQuotes(symbols, Date.now(), maxAgeMs);
    if (map.size === 0) return null;
    const list = symbols
      .map((s) => map.get(`${s.exchange}.${s.code}`))
      .filter(isValidQuote);
    return list.length > 0 ? list : null;
  },

  /** 写回缓存（空数据 / 0 价不写） */
  async save(symbols: Symbol[], quotes: Quote[]): Promise<void> {
    if (symbols.length === 0 || quotes.length === 0) return;
    const valid = quotes.filter(isValidQuote);
    if (valid.length === 0) return;
    await domainCache().putQuotes(valid, QUOTES_MAX_AGE_MS);
  },

  /** 过期物理清理（只清 quote_snapshot）。 */
  async pruneExpired(_ttlMs: number, now: number = Date.now()): Promise<number> {
    return domainCache().pruneQuoteSnapshot(now);
  },
};
