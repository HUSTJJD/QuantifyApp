/**
 * K 线数据库引擎 —— AsyncStorage 回落实现。
 *
 * 生产环境走 SqliteKlineAdapter（原生 op-sqlite）；本实现用于「原生引擎不可用」的场景：
 * jest 单测、未接入原生模块的 Web/调试环境。
 *
 * 实现上以 `${symbol}|${period}|${ts}` 为行键维护一张 Map 表，落地"行级数据库"语义
 * （upsert / 区间 / 最近 N 根 / 删除 / 清理），整表序列化进单个 key `app.kline.db.v1`。
 * 配合 KlineDatabase 的内存热索引，同屏盯盘读取基本命中内存，避免反复 JSON.parse 大数组。
 *
 * 注意：整表序列化意味着每次写入都是 O(总行数)，只适合小数据量回落场景，
 * 不适合真机全市场同步（那正是 SQLite 引擎存在的意义）。
 */
import type { KlinePeriod, Symbol } from '@/api';
import { AsyncStorageAdapter } from './storage/AsyncStorageAdapter';
import { KlineRow, symbolKey } from './KlineSchema';
import type { KlineDatabasePort } from './KlineDatabase';

const DB_KEY = 'app.kline.db.v1';

interface KlineTable {
  rows: KlineRow[];
}

type RowMap = Map<string, KlineRow>;
const rowKey = (symbol: string, period: KlinePeriod, ts: number) =>
  `${symbol}|${period}|${ts}`;

export class AsyncStorageKlineAdapter implements KlineDatabasePort {
  private storage = new AsyncStorageAdapter();
  private cache: RowMap | null = null;
  private loaded = false;

  private async ensureLoaded(): Promise<RowMap> {
    if (this.loaded && this.cache) return this.cache;
    const table = await this.storage.getObject<KlineTable>(DB_KEY);
    const map: RowMap = new Map();
    if (table && Array.isArray(table.rows)) {
      for (const r of table.rows) map.set(rowKey(r.symbol, r.period, r.ts), r);
    }
    this.cache = map;
    this.loaded = true;
    return map;
  }

  private async persist(map: RowMap): Promise<void> {
    const table: KlineTable = { rows: Array.from(map.values()) };
    await this.storage.setObject(DB_KEY, table);
  }

  async upsert(rows: KlineRow[]): Promise<number> {
    const map = await this.ensureLoaded();
    let written = 0;
    for (const r of rows) {
      const k = rowKey(r.symbol, r.period, r.ts);
      const existing = map.get(k);
      // 同键以 updatedAt 较新者为准，避免旧数据覆盖新数据
      if (!existing || r.updatedAt >= existing.updatedAt) {
        map.set(k, r);
        written += 1;
      }
    }
    await this.persist(map);
    return written;
  }

  private select(
    map: RowMap,
    symbol: Symbol,
    period: KlinePeriod,
  ): KlineRow[] {
    const sk = symbolKey(symbol);
    const out: KlineRow[] = [];
    for (const r of map.values()) {
      if (r.symbol === sk && r.period === period) out.push(r);
    }
    out.sort((a, b) => a.ts - b.ts);
    return out;
  }

  async getSeries(symbol: Symbol, period: KlinePeriod): Promise<KlineRow[]> {
    const map = await this.ensureLoaded();
    return this.select(map, symbol, period);
  }

  async getRange(
    symbol: Symbol,
    period: KlinePeriod,
    fromTs?: number,
    toTs?: number,
  ): Promise<KlineRow[]> {
    const all = await this.getSeries(symbol, period);
    return all.filter(
      (r) => (fromTs === undefined || r.ts >= fromTs) && (toTs === undefined || r.ts <= toTs),
    );
  }

  async getLatest(
    symbol: Symbol,
    period: KlinePeriod,
    limit?: number,
  ): Promise<KlineRow[]> {
    const all = await this.getSeries(symbol, period);
    const sliced = limit ? all.slice(-limit) : all;
    return sliced;
  }

  async deleteSymbol(symbol: Symbol, period?: KlinePeriod): Promise<void> {
    const map = await this.ensureLoaded();
    const sk = symbolKey(symbol);
    for (const [k, r] of map) {
      if (r.symbol === sk && (period === undefined || r.period === period)) {
        map.delete(k);
      }
    }
    await this.persist(map);
  }

  async deleteRange(
    symbol: Symbol,
    period: KlinePeriod,
    fromTs: number,
    toTs: number,
  ): Promise<number> {
    const map = await this.ensureLoaded();
    const sk = symbolKey(symbol);
    let removed = 0;
    for (const [k, r] of map) {
      if (
        r.symbol === sk &&
        r.period === period &&
        r.ts >= fromTs &&
        r.ts <= toTs
      ) {
        map.delete(k);
        removed += 1;
      }
    }
    if (removed > 0) await this.persist(map);
    return removed;
  }

  async prune(beforeTs: number): Promise<number> {
    const map = await this.ensureLoaded();
    let removed = 0;
    for (const [k, r] of map) {
      if (r.updatedAt < beforeTs) {
        map.delete(k);
        removed += 1;
      }
    }
    if (removed > 0) await this.persist(map);
    return removed;
  }

  async count(): Promise<number> {
    const map = await this.ensureLoaded();
    return map.size;
  }

  async close(): Promise<void> {
    this.cache = null;
    this.loaded = false;
  }
}
