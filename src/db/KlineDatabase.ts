/**
 * K 线数据库端口与内存热索引。
 *
 * KlineDatabasePort：存储引擎无关的能力契约（upsert/getSeries/getRange/delete/prune/count）。
 * 业务层只依赖此端口，引擎可插拔（AsyncStorage 临时实现 / 原生 SQLite 后续接入）。
 *
 * KlineHotIndex：内存 LRU 索引，盯盘同屏多标的时，重复读取命中内存而非落盘——
 * 这是"同屏盯盘不卡"的关键。落盘写入后同步刷新热索引；冷数据按 LRU 淘汰。
 */
import type { Candle, KlinePeriod, Symbol } from '@/api';
import {
  candlesToRows,
  KlineRow,
  rowsToCandles,
  symbolKey,
  KLINE_MAX_ROWS_PER_SERIES,
} from './KlineSchema';

/** 存储引擎需实现的最小能力 */
export interface KlineDatabasePort {
  /** 批量 upsert（按 symbol+period+ts 去重覆盖），返回实际写入行数 */
  upsert(rows: KlineRow[]): Promise<number>;
  /** 取某标的某周期全部序列（按 ts 升序） */
  getSeries(symbol: Symbol, period: KlinePeriod): Promise<KlineRow[]>;
  /** 取某标的某周期的时间区间 [fromTs, toTs]，缺省任一边表示无界 */
  getRange(
    symbol: Symbol,
    period: KlinePeriod,
    fromTs?: number,
    toTs?: number,
  ): Promise<KlineRow[]>;
  /** 取某标的某周期最近 limit 根（默认全量） */
  getLatest(
    symbol: Symbol,
    period: KlinePeriod,
    limit?: number,
  ): Promise<KlineRow[]>;
  /** 删除某标的全周期 / 指定周期数据 */
  deleteSymbol(symbol: Symbol, period?: KlinePeriod): Promise<void>;
  /** 清理早于 beforeTs 的整行（按 updatedAt） */
  prune(beforeTs: number): Promise<number>;
  /** 统计当前总行数（诊断用） */
  count(): Promise<number>;
  /** 释放资源 */
  close(): Promise<void>;
}

/**
 * 内存热索引：以 `${symbol}|${period}` 为 key 缓存最近使用的序列。
 * 读取时先查热索引；落盘写后回写热索引；超过 capacity 按 LRU 淘汰。
 */
class KlineHotIndex {
  private map = new Map<string, KlineRow[]>();
  constructor(private capacity: number) {}

  private key(symbol: Symbol, period: KlinePeriod): string {
    return `${symbolKey(symbol)}|${period}`;
  }

  get(symbol: Symbol, period: KlinePeriod): KlineRow[] | undefined {
    const k = this.key(symbol, period);
    const v = this.map.get(k);
    if (v !== undefined) {
      // 命中即移到末尾（LRU 最近使用）
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }

  set(symbol: Symbol, period: KlinePeriod, rows: KlineRow[]): void {
    const k = this.key(symbol, period);
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, rows);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  invalidate(symbol: Symbol, period: KlinePeriod): void {
    this.map.delete(this.key(symbol, period));
  }

  clear(): void {
    this.map.clear();
  }
}

/**
 * 把新行增量合并进已有序列：按 (symbol,period,ts) 去重 upsert（同 ts 以 newer 覆盖），
 * 合并结果按 ts 升序，并截断到 KLINE_MAX_ROWS_PER_SERIES（保留最近 N 根）。
 * 纯内存操作，用于热索引维护，避免回读落盘。
 */
function mergeRows(
  existing: KlineRow[],
  incoming: KlineRow[],
): KlineRow[] {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) {
    return incoming
      .slice()
      .sort((a, b) => a.ts - b.ts)
      .slice(-KLINE_MAX_ROWS_PER_SERIES);
  }
  // 以 ts 为键建立临时 map，existing 先放，incoming 覆盖同 ts
  const byTs = new Map<number, KlineRow>();
  for (const r of existing) byTs.set(r.ts, r);
  for (const r of incoming) {
    const prev = byTs.get(r.ts);
    // updatedAt 取较大者；同 ts 且 updatedAt 相等时以 incoming 覆盖
    if (!prev || r.updatedAt >= prev.updatedAt) byTs.set(r.ts, r);
  }
  const merged = Array.from(byTs.values()).sort((a, b) => a.ts - b.ts);
  return merged.length > KLINE_MAX_ROWS_PER_SERIES
    ? merged.slice(-KLINE_MAX_ROWS_PER_SERIES)
    : merged;
}

/**
 * 带热索引的数据库门面：组合 Port + HotIndex，对业务层暴露便捷方法。
 * 后续替换引擎只需传入不同 Port 实现，门面逻辑不变。
 */
export class KlineDatabase {
  private index: KlineHotIndex;
  private closed = false;

  constructor(
    private port: KlineDatabasePort,
    hotCapacity = 64,
  ) {
    this.index = new KlineHotIndex(hotCapacity);
  }

  /**
   * 写入一批 Candle（自动转行、upsert 到引擎 + 刷新热索引）。
   *
   * 性能优化：若目标序列已在热索引中，直接把新行增量合并进内存版本
   * （按 ts 去重 upsert + 升序 + 截断到上限），避免每次 upsert 后都向引擎
   * 全量回读 getSeries（AsyncStorage 引擎下是整段 JSON 读写，盯盘高频写入时
   * 会成为瓶颈）。仅当序列不在热索引（内存无全量视图）时才回读落盘，保证一致。
   */
  async saveCandles(
    symbol: Symbol,
    period: KlinePeriod,
    candles: Candle[],
  ): Promise<number> {
    if (this.closed || candles.length === 0) return 0;
    const rows = candlesToRows(symbol, period, candles);
    const written = await this.port.upsert(rows);

    const cached = this.index.get(symbol, period);
    if (cached) {
      this.index.set(symbol, period, mergeRows(cached, rows));
    } else {
      // 内存无全量视图，回读落盘以保证热索引用的是权威数据
      const fresh = await this.port.getSeries(symbol, period);
      this.index.set(symbol, period, fresh);
    }
    return written;
  }

  /** 读取序列：先热索引，未命中再落盘并回填 */
  async getCandles(symbol: Symbol, period: KlinePeriod): Promise<Candle[]> {
    if (this.closed) return [];
    const hit = this.index.get(symbol, period);
    if (hit) return rowsToCandles(hit);
    const rows = await this.port.getSeries(symbol, period);
    if (rows.length > 0) this.index.set(symbol, period, rows);
    return rowsToCandles(rows);
  }

  /** 取最近 limit 根（盯盘主路径，命中热索引最快） */
  async getLatestCandles(
    symbol: Symbol,
    period: KlinePeriod,
    limit?: number,
  ): Promise<Candle[]> {
    if (this.closed) return [];
    const hit = this.index.get(symbol, period);
    if (hit) {
      const sliced = limit ? hit.slice(-limit) : hit;
      return rowsToCandles(sliced);
    }
    const rows = await this.port.getLatest(symbol, period, limit);
    // 若拉的是全量且未超上限，回填热索引；否则仅返回不缓存（避免半截序列误导）
    if (!limit || rows.length < KLINE_MAX_ROWS_PER_SERIES) {
      const full = await this.port.getSeries(symbol, period);
      this.index.set(symbol, period, full);
    }
    return rowsToCandles(rows);
  }

  async getRangeCandles(
    symbol: Symbol,
    period: KlinePeriod,
    fromTs?: number,
    toTs?: number,
  ): Promise<Candle[]> {
    if (this.closed) return [];
    const rows = await this.port.getRange(symbol, period, fromTs, toTs);
    return rowsToCandles(rows);
  }

  /** 该序列最近一次写入时间（毫秒）；无数据返回 0。用于硬过期判断 */
  async getUpdatedAt(symbol: Symbol, period: KlinePeriod): Promise<number> {
    if (this.closed) return 0;
    const hit = this.index.get(symbol, period);
    if (hit && hit.length > 0) {
      return hit.reduce((m, r) => (r.updatedAt > m ? r.updatedAt : m), 0);
    }
    const rows = await this.port.getSeries(symbol, period);
    return rows.reduce((m, r) => (r.updatedAt > m ? r.updatedAt : m), 0);
  }

  async deleteSymbol(symbol: Symbol, period?: KlinePeriod): Promise<void> {
    await this.port.deleteSymbol(symbol, period);
    if (period) this.index.invalidate(symbol, period);
    else this.index.clear();
  }

  async prune(beforeTs: number): Promise<number> {
    const n = await this.port.prune(beforeTs);
    this.index.clear();
    return n;
  }

  async count(): Promise<number> {
    return this.port.count();
  }

  /** 清空热索引（落盘数据仍在，用于内存紧张时回收） */
  clearHot(): void {
    this.index.clear();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.index.clear();
    await this.port.close();
  }
}
