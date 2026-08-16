/**
 * K 线缓存层（基于 K 线数据库的行级存储门面）。
 *
 * 旧实现：整段 JSON 序列化进单个 AsyncStorage key，每次读写都全量 parse/stringify，
 * 同屏盯盘多标的时 CPU 与序列化开销大、AsyncStorage 串行队列易阻塞。
 *
 * 新实现：复用 src/db 的 KlineDatabase（内存热索引 + 行级引擎），对外仍保持旧签名
 * getEntry(symbol, period, sourceId) / save(symbol, period, sourceId, candles)，
 * 让 MarketDataClient 零改动。内部改为按 symbol+period 行级 upsert，
 * 同屏重复读取命中内存热索引，避免反复解析大数组。
 */
import type { Candle, KlinePeriod, Symbol } from '@/api';
import { database } from '@/db';

export interface KlineEntry {
  candles: Candle[];
  /** 自记录更新以来经过的秒数（基于最近一根 bar 的 updatedAt） */
  ageSec: number;
  /** 是否超过 staleSec 阈值（本层不强制，交由调用方结合 hardTtl 判断） */
  isStale: boolean;
  /** 记录更新时间戳（毫秒），最近一次成功写入时刻 */
  updatedAt: number;
}

const STALE_DEFAULT_SEC = 60;

export const KlineCache = {
  /**
   * 读取某标的某周期 K 线（含新鲜度判断）。命中内存热索引最快。
   */
  async getEntry(
    symbol: Symbol,
    period: KlinePeriod,
    _sourceId: string,
    staleSec: number = STALE_DEFAULT_SEC,
  ): Promise<KlineEntry | null> {
    const db = database();
    const candles = await db.getCandles(symbol, period);
    if (candles.length === 0) return null;
    const updatedAt = await db.getUpdatedAt(symbol, period);
    const ageSec = updatedAt > 0 ? Math.floor((Date.now() - updatedAt) / 1000) : 0;
    return { candles, ageSec, isStale: ageSec > staleSec, updatedAt };
  },

  /** 全量保存（整段覆盖式 upsert，重复 ts 覆盖） */
  async save(
    symbol: Symbol,
    period: KlinePeriod,
    _sourceId: string,
    candles: Candle[],
  ): Promise<void> {
    if (!candles || candles.length === 0) return;
    await database().saveCandles(symbol, period, candles);
  },

  /** 增量保存（只 upsert 变化的若干根，典型盯盘刷新路径） */
  async saveIncremental(
    symbol: Symbol,
    period: KlinePeriod,
    _sourceId: string,
    candles: Candle[],
  ): Promise<void> {
    await this.save(symbol, period, _sourceId, candles);
  },

  /** 清理早于 beforeTs 的行（按 updatedAt） */
  async pruneExpired(beforeTs: number): Promise<number> {
    return database().prune(beforeTs);
  },

  /** 删除某标的（全周期） */
  async deleteSymbol(_sourceId: string, symbol: Symbol): Promise<void> {
    await database().deleteSymbol(symbol);
  },

  /** 当前库内总行数（诊断） */
  async count(): Promise<number> {
    return database().count();
  },
};

/** 取序列中最后一根 bar 的时间（毫秒） */
export function lastTimeMs(candles: Candle[]): number {
  if (!candles || candles.length === 0) return 0;
  const last = candles[candles.length - 1];
  return typeof last.datetime === 'number' ? last.datetime : Date.parse(last.datetime);
}

/**
 * 合并缓存与增量：以时间(ms)去重，增量覆盖同键缓存，结果按时间升序并截断到 keep 根。
 * 用于「缓存为底 + 增量补齐」的盯盘刷新路径。
 */
export function mergeCandles(
  base: Candle[],
  inc: Candle[],
  keep: number,
): Candle[] {
  const map = new Map<number, Candle>();
  const push = (c: Candle) => {
    const t = typeof c.datetime === 'number' ? c.datetime : Date.parse(c.datetime);
    if (Number.isNaN(t)) return;
    map.set(t, c);
  };
  base.forEach(push);
  inc.forEach(push);
  const merged = Array.from(map.values()).sort((a, b) => {
    const ta = typeof a.datetime === 'number' ? a.datetime : Date.parse(a.datetime);
    const tb = typeof b.datetime === 'number' ? b.datetime : Date.parse(b.datetime);
    return ta - tb;
  });
  return keep > 0 ? merged.slice(-keep) : merged;
}
