/**
 * db 内核单测：applySchema 幂等建表（无迁移、无版本号）。
 *
 * 真机 SQLite 无法在 jest 中加载，用假连接驱动 applySchema，
 * 验证全部 DDL 会被执行。
 */
import type { DB, Scalar } from '@op-engineering/op-sqlite';
import { applySchema, DDL_STATEMENTS } from '@/data/db/schema';
import { closeSqlite, getSqlite, isSqliteAvailable } from '@/data/db/connection';

function fakeDb() {
  const executed: { sql: string; params?: Scalar[] }[] = [];
  const db = {
    executed,
    async execute(sql: string, params?: Scalar[]) {
      executed.push({ sql, params });
      return { rows: [], rowsAffected: 0 };
    },
    async transaction(fn: (tx: unknown) => Promise<void>) {
      await fn({
        execute: (sql: string, params?: Scalar[]) => {
          executed.push({ sql, params });
          return Promise.resolve({ rows: [], rowsAffected: 0 });
        },
        commit: () => Promise.resolve({ rows: [], rowsAffected: 0 }),
        rollback: () => ({ rows: [], rowsAffected: 0 }),
      });
    },
    close: () => {},
  };
  return db as unknown as DB & { executed: { sql: string; params?: Scalar[] }[] };
}

describe('applySchema（无迁移）', () => {
  it('执行全部 DDL_STATEMENTS', async () => {
    const db = fakeDb();
    await applySchema(db);
    const ddlCount = db.executed.filter((e) => /CREATE (TABLE|INDEX)/.test(e.sql)).length;
    expect(ddlCount).toBeGreaterThanOrEqual(DDL_STATEMENTS.length);
  });

  it('幂等：重复 applySchema 仍可执行', async () => {
    const db = fakeDb();
    await applySchema(db);
    const n = db.executed.length;
    await applySchema(db);
    expect(db.executed.length).toBe(n * 2);
  });

  it('DDL 必须含 IF NOT EXISTS', () => {
    for (const ddl of DDL_STATEMENTS) {
      expect(ddl).toMatch(/IF NOT EXISTS/);
    }
  });
});

describe('连接可用性', () => {
  afterEach(() => {
    closeSqlite();
  });

  it('jest 环境 SQLite 不可用，getSqlite 返回 null', async () => {
    expect(isSqliteAvailable()).toBe(false);
    expect(await getSqlite()).toBeNull();
  });
});
