/**
 * 市场元数据存储门面：全市场标的库（tickers）与同步进度（sync_state）。
 *
 * 复用 connection.ts 的共享 SQLite 连接（op-sqlite，同 db 文件），
 * 仅当原生 SQLite 可用时有效；jest / 未接入环境回落内存实现（静态 Map，进程内共享）。
 *
 * 改造要点：
 *  - 不再 `new SqliteKlineAdapter()` 拿连接（原来每次调用开一条新连接）；
 *  - 批量写走 executeBatch（单语句多组参数，内部事务），5000+ 标的入库不再逐行往返；
 *  - 统计场景新增 count* 方法（SQL COUNT），避免设置页为显示几个数字拉全表。
 */
import type { DB, Scalar } from '@op-engineering/op-sqlite';
import type { Instrument } from '@/data/api';
import type { KlinePeriod } from '@/data/api/types';
import { getSqlite } from './connection';

/** 标的库条目（symbol 归一化为 exchange.code） */
export interface TickerEntry {
  symbol: string;
  name: string;
  exchange: string;
  assetType: string;
}

/** 同步进度条目 */
export interface SyncStateEntry {
  symbol: string;
  period: KlinePeriod;
  lastSyncMs: number;
}

/** 复权因子条目（与 AdjustmentFactorInput 兼容，symbol 归一化为 exchange.code） */
export interface AdjustmentFactorEntry {
  symbol: string;
  exDateMs: number;
  dividendPerShare: number | null;
  perShareBonus: number | null;
  allotmentRatio: number | null;
  allotmentPrice: number | null;
}

/** op-sqlite 结果行 → 复权因子条目 */
function toFactor(r: Record<string, Scalar>): AdjustmentFactorEntry {
  return {
    symbol: String(r.symbol),
    exDateMs: Number(r.exDateMs),
    dividendPerShare: r.dividendPerShare == null ? null : Number(r.dividendPerShare),
    perShareBonus: r.perShareBonus == null ? null : Number(r.perShareBonus),
    allotmentRatio: r.allotmentRatio == null ? null : Number(r.allotmentRatio),
    allotmentPrice: r.allotmentPrice == null ? null : Number(r.allotmentPrice),
  };
}

/** 取 COUNT(*) 查询的标量结果 */
function countOf(res: { rows?: Array<Record<string, Scalar>> }): number {
  const first = res.rows?.[0] as { n?: Scalar } | undefined;
  return Number(first?.n ?? 0);
}

/** 批量写入的分批大小 */
const BATCH_SIZE = 500;

export class MarketMetaStore {
  /** 内存回落引擎的共享状态（同进程多实例可见；jest/未接入原生时使用） */
  private static memTickers = new Map<string, TickerEntry>();
  private static memSync = new Map<string, SyncStateEntry>();
  private static memFactors = new Map<string, AdjustmentFactorEntry>();

  /** 共享 SQLite 连接；不可用（jest/无原生）时返回 null → 走内存回落 */
  private async db(): Promise<DB | null> {
    return getSqlite();
  }

  // ---------- tickers ----------

  /** 全量替换标的库（增量同步底座更新） */
  async replaceTickers(list: Instrument[]): Promise<number> {
    const entries: TickerEntry[] = list.map((it) => ({
      symbol: `${it.symbol.exchange}.${it.symbol.code}`,
      name: it.name ?? '',
      exchange: it.symbol.exchange,
      assetType: it.assetType ?? '',
    }));

    const db = await this.db();
    if (db) {
      await db.transaction(async (tx) => {
        await tx.execute('DELETE FROM tickers');
      });
      const sql =
        'INSERT OR REPLACE INTO tickers (symbol, name, exchange, assetType) VALUES (?, ?, ?, ?)';
      for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const chunk = entries.slice(i, i + BATCH_SIZE);
        await db.executeBatch([
          [sql, chunk.map((e) => [e.symbol, e.name, e.exchange, e.assetType])],
        ]);
      }
    } else {
      MarketMetaStore.memTickers.clear();
      for (const e of entries) MarketMetaStore.memTickers.set(e.symbol, e);
    }
    return entries.length;
  }

  /** 取全市场标的清单 */
  async getTickers(): Promise<TickerEntry[]> {
    const db = await this.db();
    if (db) {
      const res = await db.execute('SELECT * FROM tickers ORDER BY symbol ASC');
      return ((res.rows ?? []) as Array<Record<string, Scalar>>).map((r) => ({
        symbol: String(r.symbol),
        name: String(r.name ?? ''),
        exchange: String(r.exchange),
        assetType: String(r.assetType ?? ''),
      }));
    }
    return Array.from(MarketMetaStore.memTickers.values());
  }

  async countTickers(): Promise<number> {
    const db = await this.db();
    if (db) {
      return countOf(await db.execute('SELECT COUNT(*) AS n FROM tickers'));
    }
    return MarketMetaStore.memTickers.size;
  }

  // ---------- sync_state ----------

  async setSyncState(symbol: string, period: KlinePeriod, lastSyncMs: number): Promise<void> {
    const db = await this.db();
    if (db) {
      await db.execute(
        'INSERT OR REPLACE INTO sync_state (symbol, period, lastSyncMs) VALUES (?, ?, ?)',
        [symbol, period, lastSyncMs],
      );
    } else {
      MarketMetaStore.memSync.set(`${symbol}|${period}`, { symbol, period, lastSyncMs });
    }
  }

  async getSyncState(symbol: string, period: KlinePeriod): Promise<number> {
    const db = await this.db();
    if (db) {
      const res = await db.execute(
        'SELECT lastSyncMs FROM sync_state WHERE symbol=? AND period=?',
        [symbol, period],
      );
      const first = res.rows?.[0] as { lastSyncMs?: Scalar } | undefined;
      return Number(first?.lastSyncMs ?? 0);
    }
    return MarketMetaStore.memSync.get(`${symbol}|${period}`)?.lastSyncMs ?? 0;
  }

  async getSyncStates(): Promise<SyncStateEntry[]> {
    const db = await this.db();
    if (db) {
      const res = await db.execute('SELECT * FROM sync_state ORDER BY symbol ASC');
      return ((res.rows ?? []) as Array<Record<string, Scalar>>).map((r) => ({
        symbol: String(r.symbol),
        period: String(r.period) as KlinePeriod,
        lastSyncMs: Number(r.lastSyncMs),
      }));
    }
    return Array.from(MarketMetaStore.memSync.values());
  }

  /** 已同步过的标的数量（DISTINCT symbol），设置页统计用，避免拉全表 */
  async countSyncedSymbols(): Promise<number> {
    const db = await this.db();
    if (db) {
      return countOf(
        await db.execute('SELECT COUNT(DISTINCT symbol) AS n FROM sync_state'),
      );
    }
    return new Set(Array.from(MarketMetaStore.memSync.values()).map((s) => s.symbol)).size;
  }

  // ---------- adjustment_factors ----------

  /** 全量替换某标的复权因子（增量同步时按标的刷新） */
  async replaceFactors(symbol: string, factors: AdjustmentFactorEntry[]): Promise<number> {
    const db = await this.db();
    if (db) {
      await db.transaction(async (tx) => {
        await tx.execute('DELETE FROM adjustment_factors WHERE symbol = ?', [symbol]);
      });
      if (factors.length > 0) {
        const sql =
          'INSERT OR REPLACE INTO adjustment_factors (symbol, exDateMs, dividendPerShare, perShareBonus, allotmentRatio, allotmentPrice) VALUES (?, ?, ?, ?, ?, ?)';
        await db.executeBatch([
          [
            sql,
            factors.map((f) => [
              f.symbol,
              f.exDateMs,
              f.dividendPerShare,
              f.perShareBonus,
              f.allotmentRatio,
              f.allotmentPrice,
            ]),
          ],
        ]);
      }
    } else {
      for (const [k] of MarketMetaStore.memFactors) {
        if (k.startsWith(`${symbol}|`)) MarketMetaStore.memFactors.delete(k);
      }
      for (const f of factors) {
        MarketMetaStore.memFactors.set(`${f.symbol}|${f.exDateMs}`, f);
      }
    }
    return factors.length;
  }

  /** 取某标的全部复权因子（按除权日升序） */
  async getFactors(symbol: string): Promise<AdjustmentFactorEntry[]> {
    const db = await this.db();
    if (db) {
      const res = await db.execute(
        'SELECT * FROM adjustment_factors WHERE symbol = ? ORDER BY exDateMs ASC',
        [symbol],
      );
      return ((res.rows ?? []) as Array<Record<string, Scalar>>).map(toFactor);
    }
    return Array.from(MarketMetaStore.memFactors.values())
      .filter((f) => f.symbol === symbol)
      .sort((a, b) => a.exDateMs - b.exDateMs);
  }

  /** 全部复权因子（诊断/导出用；仅统计数量请用 countFactors） */
  async getFactorsAll(): Promise<AdjustmentFactorEntry[]> {
    const db = await this.db();
    if (db) {
      const res = await db.execute(
        'SELECT * FROM adjustment_factors ORDER BY symbol ASC, exDateMs ASC',
      );
      return ((res.rows ?? []) as Array<Record<string, Scalar>>).map(toFactor);
    }
    return Array.from(MarketMetaStore.memFactors.values());
  }

  /** 复权因子总数（设置页统计用） */
  async countFactors(): Promise<number> {
    const db = await this.db();
    if (db) {
      return countOf(await db.execute('SELECT COUNT(*) AS n FROM adjustment_factors'));
    }
    return MarketMetaStore.memFactors.size;
  }

  /** 测试用：清空内存回落状态 */
  static resetMem(): void {
    MarketMetaStore.memTickers.clear();
    MarketMetaStore.memSync.clear();
    MarketMetaStore.memFactors.clear();
  }
}
