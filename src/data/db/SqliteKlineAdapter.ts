/**
 * 原生 SQLite K 线引擎适配器（@op-engineering/op-sqlite）。
 *
 * 相比 AsyncStorage 整表序列化：
 *   - 行级 upsert（INSERT ... ON CONFLICT），增量只落变化的 bar；
 *   - 主键 (symbol, period, ts) + 覆盖索引，区间 / 最近 N 根走索引；
 *   - 支撑全市场千万行级数据（量化本地库底座）。
 *
 * 改造要点（本次）：
 *   - 连接不再自持：统一取 connection.ts 的共享单例，跨 Store 只有一条连接；
 *   - 建表 SQL 移到 schema.ts，本文件只留 K 线相关的 DML；
 *   - upsert 由「逐行 SELECT 比对 + INSERT」改为批量 executeBatch + ON CONFLICT，
 *     一次 JSI 调用写完一批（默认 500 行），全市场同步的往返开销大幅下降；
 *   - 冲突解决下沉到 SQL：只有 excluded.updatedAt >= 现有行的 updatedAt 才覆盖，
 *     旧数据不会覆盖新数据（与内存/AsyncStorage 引擎语义一致）。
 *
 * op-sqlite API 备忘：
 *   - open({ name, location }) 同步返回 DB 连接；
 *   - execute(query, params) 返回 Promise<QueryResult>，res.rows 即行数组；
 *   - executeBatch([[sql, params[]]]) 单语句多组参数，内部包在事务里；
 *   - transaction(tx => Promise<void>)：tx.execute / commit 为异步，rollback 同步。
 */
import type { DB, QueryResult, Scalar } from '@op-engineering/op-sqlite';
import type { KlinePeriod, Symbol } from '@/api';
import { KlineRow, symbolKey } from './KlineSchema';
import type { KlineDatabasePort } from './KlineDatabase';
import { getSqlite } from './connection';

/**
 * 行级 upsert：同 (symbol, period, ts) 已存在时按 updatedAt 取新。
 * WHERE excluded.updatedAt >= kline.updatedAt：旧快照不会覆盖新数据，
 * 且不满足条件时该行不计入 rowsAffected（即"未写入"），与返回语义一致。
 */
const SQL_UPSERT = `
INSERT INTO kline
  (symbol, period, ts, open, high, low, close, volume, amount, updatedAt)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(symbol, period, ts) DO UPDATE SET
  open = excluded.open,
  high = excluded.high,
  low = excluded.low,
  close = excluded.close,
  volume = excluded.volume,
  amount = excluded.amount,
  updatedAt = excluded.updatedAt
WHERE excluded.updatedAt >= kline.updatedAt
`;

const SQL_SERIES =
  'SELECT * FROM kline WHERE symbol = ? AND period = ? ORDER BY ts ASC';

const SQL_RANGE =
  'SELECT * FROM kline WHERE symbol = ? AND period = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC';

const SQL_LATEST =
  'SELECT * FROM kline WHERE symbol = ? AND period = ? ORDER BY ts DESC LIMIT ?';

const SQL_DELETE_SYMBOL = 'DELETE FROM kline WHERE symbol = ? AND period = ?';

const SQL_DELETE_SYMBOL_ALL = 'DELETE FROM kline WHERE symbol = ?';

const SQL_DELETE_RANGE =
  'DELETE FROM kline WHERE symbol = ? AND period = ? AND ts >= ? AND ts <= ?';

const SQL_PRUNE = 'DELETE FROM kline WHERE updatedAt < ?';

const SQL_COUNT = 'SELECT COUNT(*) AS n FROM kline';

/** executeBatch 单批行数：兼顾 JSI 单次调用开销与单条 SQL 长度 */
const UPSERT_BATCH_SIZE = 500;

/** op-sqlite 查询结果行 → KlineRow */
function toKlineRow(raw: Record<string, Scalar>): KlineRow {
  return {
    symbol: String(raw.symbol),
    period: String(raw.period) as KlinePeriod,
    ts: Number(raw.ts),
    open: Number(raw.open),
    high: Number(raw.high),
    low: Number(raw.low),
    close: Number(raw.close),
    volume: Number(raw.volume ?? 0),
    amount: Number(raw.amount ?? 0),
    updatedAt: Number(raw.updatedAt),
  };
}

function toKlineRows(res: QueryResult): KlineRow[] {
  const rows = (res.rows ?? []) as Array<Record<string, Scalar>>;
  return rows.map(toKlineRow);
}

export class SqliteKlineAdapter implements KlineDatabasePort {
  /** 取共享连接；原生不可用时抛错（工厂层已保证只在可用时构造本适配器） */
  private async db(): Promise<DB> {
    const db = await getSqlite();
    if (!db) throw new Error('SQLite 不可用：当前环境未接入原生 op-sqlite');
    return db;
  }

  /** 建库建表（幂等；由共享连接保证只做一次） */
  async ensureSchema(): Promise<void> {
    await this.db();
  }

  async upsert(rows: KlineRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const db = await this.db();
    let written = 0;

    for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
      const chunk = rows.slice(i, i + UPSERT_BATCH_SIZE);
      const params: Scalar[][] = chunk.map((r) => [
        r.symbol,
        r.period,
        r.ts,
        r.open,
        r.high,
        r.low,
        r.close,
        r.volume,
        r.amount,
        r.updatedAt,
      ]);
      const res = await db.executeBatch([[SQL_UPSERT, params]]);
      // rowsAffected 为引擎聚合值；个别平台不返回时退化为"本批行数"
      written +=
        res.rowsAffected === undefined ? chunk.length : Number(res.rowsAffected);
    }
    return written;
  }

  async getSeries(symbol: Symbol, period: KlinePeriod): Promise<KlineRow[]> {
    const db = await this.db();
    const res = await db.execute(SQL_SERIES, [symbolKey(symbol), period]);
    return toKlineRows(res);
  }

  async getRange(
    symbol: Symbol,
    period: KlinePeriod,
    fromTs?: number,
    toTs?: number,
  ): Promise<KlineRow[]> {
    // 无界任一边：退化为全序列（避免 NULL 参数）
    if (fromTs === undefined || toTs === undefined) {
      return this.getSeries(symbol, period);
    }
    const db = await this.db();
    const res = await db.execute(SQL_RANGE, [
      symbolKey(symbol),
      period,
      fromTs,
      toTs,
    ]);
    return toKlineRows(res);
  }

  async getLatest(
    symbol: Symbol,
    period: KlinePeriod,
    limit?: number,
  ): Promise<KlineRow[]> {
    if (limit == null || limit <= 0) return this.getSeries(symbol, period);
    const db = await this.db();
    const res = await db.execute(SQL_LATEST, [symbolKey(symbol), period, limit]);
    // SQL 取的是倒序最近 N 根，返回需还原为升序
    return toKlineRows(res).reverse();
  }

  async deleteSymbol(symbol: Symbol, period?: KlinePeriod): Promise<void> {
    const db = await this.db();
    if (period) {
      await db.execute(SQL_DELETE_SYMBOL, [symbolKey(symbol), period]);
    } else {
      await db.execute(SQL_DELETE_SYMBOL_ALL, [symbolKey(symbol)]);
    }
  }

  async deleteRange(
    symbol: Symbol,
    period: KlinePeriod,
    fromTs: number,
    toTs: number,
  ): Promise<number> {
    const db = await this.db();
    const res = await db.execute(SQL_DELETE_RANGE, [
      symbolKey(symbol),
      period,
      fromTs,
      toTs,
    ]);
    return Number(res.rowsAffected ?? 0);
  }

  async prune(beforeTs: number): Promise<number> {
    const db = await this.db();
    const res = await db.execute(SQL_PRUNE, [beforeTs]);
    return Number(res.rowsAffected ?? 0);
  }

  async count(): Promise<number> {
    const db = await this.db();
    const res = await db.execute(SQL_COUNT);
    const first = res.rows?.[0] as { n?: Scalar } | undefined;
    return Number(first?.n ?? 0);
  }

  /**
   * 连接所有权在 connection.ts，适配器关闭时不关连接（否则会把
   * MarketMetaStore 等共享方一起断掉）。真正关闭走 closeSqlite()。
   */
  async close(): Promise<void> {
    // no-op：共享连接由 connection.ts 统一管理
  }
}
