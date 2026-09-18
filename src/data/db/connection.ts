/**
 * 本地 SQLite 连接单例（全库唯一入口）。
 *
 * 策略：**无数据迁移**。打开后读 schema_version：
 *  - 与 schema.SCHEMA_VERSION 不一致（含全新库 version=0）→ db.delete() 删库重建；
 *  - 一致 → 复用现有库，applySchema 仅幂等 CREATE IF NOT EXISTS + 打版本。
 *
 * jest / 未接入原生环境：isSqliteAvailable() 恒 false，getSqlite() 返回 null，
 * 各 Store 自动回落到内存实现。
 */
import { open } from '@op-engineering/op-sqlite';
import type { DB } from '@op-engineering/op-sqlite';
import {
  applySchema,
  needsDatabaseReset,
  readSchemaVersion,
  SQLITE_DB_LOCATION,
  SQLITE_DB_NAME,
} from './schema';

/** 当前进程已打开的连接（null = 尚未打开） */
let conn: DB | null = null;
/** 正在打开中的 Promise（并发去重） */
let opening: Promise<DB> | null = null;

function openDb(): DB {
  return open({ name: SQLITE_DB_NAME, location: SQLITE_DB_LOCATION });
}

/** 原生 SQLite 是否可用（jest / 无原生模块时为 false） */
export function isSqliteAvailable(): boolean {
  if (typeof jest !== 'undefined' || process.env.NODE_ENV === 'test') return false;
  return true;
}

async function openAndMigrate(): Promise<DB> {
  let db = openDb();
  const stored = await readSchemaVersion(db);
  if (needsDatabaseReset(stored)) {
    // 版本不一致：删库重建（不迁移）。delete 后重新 open 拿到空库文件。
    try {
      db.delete();
    } catch {
      // 文件可能尚未落盘 / 已删除
    }
    try {
      db.close();
    } catch {
      // ignore
    }
    db = openDb();
  }
  try {
    await db.execute('PRAGMA journal_mode = WAL');
    await db.execute('PRAGMA synchronous = NORMAL');
  } catch {
    // PRAGMA 失败不影响可用性
  }
  await applySchema(db);
  return db;
}

/** 打开（或复用）本地库连接；不可用时返回 null */
export async function getSqlite(): Promise<DB | null> {
  if (!isSqliteAvailable()) return null;
  if (conn) return conn;
  if (opening) return opening;

  opening = (async () => {
    const db = await openAndMigrate();
    conn = db;
    return db;
  })();

  try {
    return await opening;
  } finally {
    opening = null;
  }
}

/** 关闭连接（进程退出 / 热重载 / 测试收尾用）；幂等 */
export function closeSqlite(): void {
  try {
    conn?.close();
  } catch {
    // 关闭失败无需向上抛
  }
  conn = null;
  opening = null;
}

/** 强制删库重建（调试/设置页「清空本地数据」用） */
export async function resetSqliteDatabase(): Promise<void> {
  closeSqlite();
  if (!isSqliteAvailable()) return;
  const db = openDb();
  try {
    db.delete();
  } catch {
    // ignore
  }
  try {
    db.close();
  } catch {
    // ignore
  }
  // 下次 getSqlite 会重新 open + applySchema
}

/** 诊断用：连接状态 */
export async function getSqliteInfo(): Promise<{
  available: boolean;
  connected: boolean;
}> {
  const db = await getSqlite();
  if (!db) return { available: false, connected: false };
  return { available: true, connected: true };
}
