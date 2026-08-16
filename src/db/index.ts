/**
 * K 线数据库工厂（单例入口）。
 *
 * 业务层统一从这里取 KlineDatabase 实例，不关心底层引擎。
 * 当前默认 AsyncStorage 临时引擎；后续接入原生 SQLite 时，
 * 只需把 database() 内的适配器构造换成 NitroSqliteKlineAdapter（见其文件头）。
 */
import { KlineDatabase } from './KlineDatabase';
import { AsyncStorageKlineAdapter } from './AsyncStorageKlineAdapter';
import { NitroSqliteKlineAdapter, isNitroSqliteAvailable } from './NitroSqliteKlineAdapter';

let instance: KlineDatabase | null = null;

/** 获取全局唯一的 K 线数据库实例（懒加载、单例） */
export function database(): KlineDatabase {
  if (instance) return instance;
  const adapter = isNitroSqliteAvailable()
    ? new NitroSqliteKlineAdapter()
    : new AsyncStorageKlineAdapter();
  instance = new KlineDatabase(adapter);
  return instance;
}

/** 测试 / 热重载场景下重置单例 */
export function resetDatabase(): void {
  instance = null;
}

/** 测试 / 进程退出时关闭底层资源，避免句柄泄漏 */
export async function closeDatabase(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}

export { KlineDatabase } from './KlineDatabase';
export type { KlineDatabasePort } from './KlineDatabase';
export * from './KlineSchema';
