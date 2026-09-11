/**
 * 本地 SQLite 连接单例（全库唯一入口）。
 *
 * 背景：改造前 MarketMetaStore 每次调用都 `new SqliteKlineAdapter()`，
 * 每个实例内部各自 `open()` 一个连接 —— 一次同步会打开成百上千个 SQLite 连接
 * （句柄泄漏 + 写锁竞争）。现在连接由本模块独占持有：
 *  - 懒打开，首次访问时建库建表（applySchema 幂等）；
 *  - 并发调用共用同一次打开过程（opening Promise 去重），不会重复 open；
 *  - K 线适配器与 MarketMetaStore 共用同一连接，跨表事务/一致性才有保障；
 *  - 关闭由 closeSqlite() 统一负责，适配器不再持有连接所有权。
 *
 * jest / 未接入原生环境：isSqliteAvailable() 恒 false，getSqlite() 返回 null，
 * 各 Store 自动回落到内存实现（单测行为不变）。
 */
import { open } from '@op-engineering/op-sqlite';
import type { DB } from '@op-engineering/op-sqlite';
import { applySchema, SQLITE_DB_LOCATION, SQLITE_DB_NAME } from './schema';

/** 当前进程已打开的连接（null = 尚未打开） */
let conn: DB | null = null;
/** 正在打开中的 Promise（并发去重） */
let opening: Promise<DB> | null = null;

/** 原生 SQLite 是否可用（jest / 无原生模块时为 false） */
export function isSqliteAvailable(): boolean {
  if (typeof jest !== 'undefined' || process.env.NODE_ENV === 'test') return false;
  return true;
}

/** 打开（或复用）本地库连接；不可用时返回 null */
export async function getSqlite(): Promise<DB | null> {
  if (!isSqliteAvailable()) return null;
  if (conn) return conn;
  if (opening) return opening;

  opening = (async () => {
    const db = open({ name: SQLITE_DB_NAME, location: SQLITE_DB_LOCATION });
    // WAL：读写不互相阻塞，全市场批量同步时读路径（盯盘）不被写事务卡住
    try {
      await db.execute('PRAGMA journal_mode = WAL');
      await db.execute('PRAGMA synchronous = NORMAL');
    } catch {
      // PRAGMA 失败不影响可用性（个别平台/只读场景），继续走默认配置
    }
    await applySchema(db);
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
    // 关闭失败无需向上抛：连接不存在或已关闭都视为成功
  }
  conn = null;
  opening = null;
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
