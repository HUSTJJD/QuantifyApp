/**
 * 本地持久化模块统一出口（db）。
 *
 * 模块结构：
 *   connection.ts      —— SQLite 连接单例（全库唯一，跨 Store 共享）
 *   schema.ts          —— 建表 DDL（无迁移，每次启动幂等 CREATE）
 *   SqliteKlineAdapter —— K 线引擎（原生 op-sqlite，生产）
 *   AsyncStorageKlineAdapter —— K 线引擎（AsyncStorage 回落：jest / 无原生模块）
 *   KlineDatabase      —— 引擎门面 + 内存热索引（业务只依赖它）
 *   MarketMetaStore    —— 标的库 / 同步进度 / 复权因子
 *   UserStore          —— 自选 / 分组 / 持仓 / 资产快照
 *   DomainCache        —— 行情领域表（quote/calendar/fund_flow/…）
 *   QuantStore         —— method_cache / trade_signal / strategy_profile / sim_* / followed
 *   storage/           —— 键值小数据层（设置项等），引擎可插拔
 *
 * 业务层入口：
 *   - 行情 API：  import { marketData } from '@/data/api'
 *   - 结构化数据：import { database, userStore, domainCache, quantStore } from '@/data/db'
 *   - 键值设置：  import { storage, StorageKeys } from '@/data/db/storage'
 */
import { KlineDatabase } from './KlineDatabase';
import { AsyncStorageKlineAdapter } from './AsyncStorageKlineAdapter';
import { SqliteKlineAdapter } from './SqliteKlineAdapter';
import { closeSqlite, isSqliteAvailable } from './connection';

let instance: KlineDatabase | null = null;

/** 获取全局唯一的 K 线数据库实例（懒加载、单例） */
export function database(): KlineDatabase {
  if (instance) return instance;
  const adapter = isSqliteAvailable()
    ? new SqliteKlineAdapter()
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
  closeSqlite();
}

export { KlineDatabase } from './KlineDatabase';
export type { KlineDatabasePort } from './KlineDatabase';
export { MarketMetaStore } from './MarketMetaStore';
export { UserStore, userStore } from './UserStore';
export { QuantStore, quantStore, resetQuantStore } from './QuantStore';
export { DomainCacheStore, domainCache, resetDomainCache, type DomainCache } from './DomainCache';
export type {
  AssetSnapshot,
  Holding,
  WatchlistGroup,
  WatchlistGroupsState,
} from './UserStore';
export * from './KlineSchema';
export * from './schema';
export { getSqlite, getSqliteInfo, closeSqlite, isSqliteAvailable } from './connection';
