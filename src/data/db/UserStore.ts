/**
 * 用户数据仓储：自选 / 自选分组 / 持仓 / 资产快照。
 *
 * 全部落本地 SQLite（与 kline/tickers 同连接）。
 * 双引擎：
 *  - 原生 SQLite 可用（真机）→ 走表；
 *  - 不可用（jest / 未接入）→ 回落 AsyncStorage（仅测试环境）。
 * 无历史库、无迁移兼容。
 *
 * 领域类型（Holding / WatchlistGroup 等）定义在这里，repositories 层转出，
 * 避免 UserStore 反向依赖 repositories 造成循环引用。
 */
import type { DB, Scalar } from '@op-engineering/op-sqlite';
import type { Symbol } from '@/api';
import { storage, StorageKeys } from './storage';
import { getSqlite } from './connection';

/** 持仓 */
export interface Holding {
  symbol: Symbol;
  /** 持仓数量（股） */
  shares: number;
  /** 成本价 */
  costPrice: number;
}

/** 资产快照 */
export interface AssetSnapshot {
  /** 时间戳（ms） */
  ts: number;
  /** 总资产（元） */
  total: number;
}

/** 自选分组 */
export interface WatchlistGroup {
  /** 分组 id，业务内唯一 */
  id: string;
  /** 分组展示名 */
  name: string;
  /** 组内标的（去重） */
  symbols: Symbol[];
}

/** 分组集合（仓储持久化的整体状态） */
export interface WatchlistGroupsState {
  groups: WatchlistGroup[];
}

/** 资产快照保留条数 */
const SNAPSHOT_KEEP = 90;

/** 默认数据已写入标记（存 meta 表） */
const META_SEEDED_WATCHLIST = 'user_seeded_watchlist';
const META_SEEDED_GROUPS = 'user_seeded_groups';

const SQL_GET_META = 'SELECT value FROM meta WHERE key = ?';
const SQL_SET_META =
  'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)';

type Row = Record<string, Scalar>;

/** 标的 → 行键（exchange.code，与 K 线库的 symbolKey 一致） */
function keyOf(s: Symbol): string {
  return `${s.exchange}.${s.code}`;
}

function toSymbol(r: Row): Symbol {
  return {
    code: String(r.code),
    exchange: String(r.exchange) as Symbol['exchange'],
    name: String(r.name ?? ''),
  };
}

async function hasMeta(db: DB, key: string): Promise<boolean> {
  const res = await db.execute(SQL_GET_META, [key]);
  return (res.rows?.length ?? 0) > 0;
}

async function setMeta(db: DB, key: string, value: string): Promise<void> {
  await db.execute(SQL_SET_META, [key, value]);
}

export class UserStore {
  private async db(): Promise<DB | null> {
    return getSqlite();
  }

  /* ----------------------------- 自选 ----------------------------- */

  /** 读自选；返回 null 表示"从未写入过"（调用方据此给默认自选） */
  async getWatchlist(): Promise<Symbol[] | null> {
    const db = await this.db();
    if (!db) return (await storage.getObject<Symbol[]>(StorageKeys.WATCHLIST)) ?? null;

    const res = await db.execute(
      'SELECT code, exchange, name FROM watchlist ORDER BY sort ASC',
    );
    const rows = (res.rows ?? []) as Row[];
    if (rows.length === 0 && !(await hasMeta(db, META_SEEDED_WATCHLIST))) return null;
    return rows.map(toSymbol);
  }

  async setWatchlist(list: Symbol[]): Promise<void> {
    const db = await this.db();
    if (!db) {
      await storage.setObject(StorageKeys.WATCHLIST, list);
      return;
    }
    await db.transaction(async (tx) => {
      await tx.execute('DELETE FROM watchlist');
    });
    if (list.length > 0) {
      await db.executeBatch([
        [
          'INSERT OR REPLACE INTO watchlist (symbol, code, exchange, name, sort) VALUES (?, ?, ?, ?, ?)',
          list.map((s, i) => [keyOf(s), s.code, s.exchange, s.name ?? '', i]),
        ],
      ]);
    }
    await setMeta(db, META_SEEDED_WATCHLIST, '1');
  }

  /* ---------------------------- 自选分组 ---------------------------- */

  async getGroups(): Promise<WatchlistGroupsState | null> {
    const db = await this.db();
    if (!db) {
      return (
        (await storage.getObject<WatchlistGroupsState>(StorageKeys.WATCHLIST_GROUPS)) ??
        null
      );
    }

    const gres = await db.execute(
      'SELECT id, name FROM watchlist_group ORDER BY sort ASC',
    );
    const groups = (gres.rows ?? []) as Row[];
    if (groups.length === 0 && !(await hasMeta(db, META_SEEDED_GROUPS))) return null;
    if (groups.length === 0) return { groups: [] };

    const ires = await db.execute(
      'SELECT group_id, code, exchange, name FROM watchlist_group_item ORDER BY sort ASC',
    );
    const byGroup = new Map<string, Symbol[]>();
    for (const r of (ires.rows ?? []) as Row[]) {
      const gid = String(r.group_id);
      const arr = byGroup.get(gid) ?? [];
      arr.push(toSymbol(r));
      byGroup.set(gid, arr);
    }
    return {
      groups: groups.map((g) => ({
        id: String(g.id),
        name: String(g.name),
        symbols: byGroup.get(String(g.id)) ?? [],
      })),
    };
  }

  async saveGroups(state: WatchlistGroupsState): Promise<void> {
    const db = await this.db();
    if (!db) {
      await storage.setObject(StorageKeys.WATCHLIST_GROUPS, state);
      return;
    }
    await db.transaction(async (tx) => {
      await tx.execute('DELETE FROM watchlist_group_item');
      await tx.execute('DELETE FROM watchlist_group');
    });

    if (state.groups.length > 0) {
      await db.executeBatch([
        [
          'INSERT OR REPLACE INTO watchlist_group (id, name, sort) VALUES (?, ?, ?)',
          state.groups.map((g, i) => [g.id, g.name, i]),
        ],
      ]);

      const items: Scalar[][] = [];
      state.groups.forEach((g) => {
        g.symbols.forEach((s, i) => {
          items.push([g.id, keyOf(s), s.code, s.exchange, s.name ?? '', i]);
        });
      });
      if (items.length > 0) {
        await db.executeBatch([
          [
            'INSERT OR REPLACE INTO watchlist_group_item (group_id, symbol, code, exchange, name, sort) VALUES (?, ?, ?, ?, ?, ?)',
            items,
          ],
        ]);
      }
    }
    await setMeta(db, META_SEEDED_GROUPS, '1');
  }

  /* ------------------------------ 持仓 ------------------------------ */

  async getHoldings(): Promise<Holding[]> {
    const db = await this.db();
    if (!db) {
      return (await storage.getObject<Holding[]>(StorageKeys.PORTFOLIO_HOLDINGS)) ?? [];
    }

    const res = await db.execute(
      'SELECT code, exchange, name, shares, cost_price FROM holding ORDER BY rowid ASC',
    );
    return ((res.rows ?? []) as Row[]).map((r) => ({
      symbol: toSymbol(r),
      shares: Number(r.shares),
      costPrice: Number(r.cost_price),
    }));
  }

  async setHoldings(list: Holding[]): Promise<void> {
    const db = await this.db();
    if (!db) {
      await storage.setObject(StorageKeys.PORTFOLIO_HOLDINGS, list);
      return;
    }
    await db.transaction(async (tx) => {
      await tx.execute('DELETE FROM holding');
    });
    if (list.length > 0) {
      await db.executeBatch([
        [
          'INSERT OR REPLACE INTO holding (symbol, code, exchange, shares, cost_price) VALUES (?, ?, ?, ?, ?)',
          list.map((h) => [
            keyOf(h.symbol),
            h.symbol.code,
            h.symbol.exchange,
            h.shares,
            h.costPrice,
          ]),
        ],
      ]);
    }
  }

  /* ---------------------------- 资产快照 ---------------------------- */

  async getSnapshots(): Promise<AssetSnapshot[]> {
    const db = await this.db();
    if (!db) {
      return (
        (await storage.getObject<AssetSnapshot[]>(StorageKeys.PORTFOLIO_SNAPSHOTS)) ?? []
      );
    }

    const res = await db.execute(
      'SELECT ts, total FROM asset_snapshot ORDER BY ts ASC',
    );
    return ((res.rows ?? []) as Row[]).map((r) => ({
      ts: Number(r.ts),
      total: Number(r.total),
    }));
  }

  /** 追加一条快照，并只保留最近 SNAPSHOT_KEEP 条 */
  async addSnapshot(snap: AssetSnapshot): Promise<void> {
    const db = await this.db();
    if (!db) {
      const list = await this.getSnapshots();
      list.push(snap);
      await storage.setObject(StorageKeys.PORTFOLIO_SNAPSHOTS, list.slice(-SNAPSHOT_KEEP));
      return;
    }
    await db.execute(
      'INSERT OR REPLACE INTO asset_snapshot (ts, total) VALUES (?, ?)',
      [snap.ts, snap.total],
    );
    // 只留最近 N 条（按 ts 倒序取 N 条的补集删掉），避免表无限增长
    await db.execute(
      `DELETE FROM asset_snapshot WHERE ts NOT IN (
         SELECT ts FROM asset_snapshot ORDER BY ts DESC LIMIT ?
       )`,
      [SNAPSHOT_KEEP],
    );
  }

  /** 全量覆盖快照（迁移用） */
  async setSnapshots(list: AssetSnapshot[]): Promise<void> {
    const db = await this.db();
    if (!db) {
      await storage.setObject(StorageKeys.PORTFOLIO_SNAPSHOTS, list.slice(-SNAPSHOT_KEEP));
      return;
    }
    await db.transaction(async (tx) => {
      await tx.execute('DELETE FROM asset_snapshot');
    });
    if (list.length > 0) {
      await db.executeBatch([
        [
          'INSERT OR REPLACE INTO asset_snapshot (ts, total) VALUES (?, ?)',
          list.slice(-SNAPSHOT_KEEP).map((s) => [s.ts, s.total]),
        ],
      ]);
    }
  }
}

/** 全局共享实例（仓储层直接用；内部无状态，持有连接的是 connection.ts） */
export const userStore = new UserStore();
