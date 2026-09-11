/**
 * 键值存储层统一出口（Barrel）+ 默认实例（db 模块的 KV 子层）。
 * 业务层只 import { storage } from '@/data/db/storage'。
 *
 * 定位：本层只负责「小体量、整存整取」的键值数据（设置项、行情缓存、搜索/告警历史等），
 * 与上层 SQLite 主库分工明确：
 *   - 结构化 / 大体量数据（K 线、标的库、自选、持仓）走 db 主库（见 ../schema.ts）；
 *   - 零散配置项与缓存走本层，默认引擎 AsyncStorage，可用 setStorage() 替换。
 * 引擎可插拔正是 StoragePort 存在的意义：换引擎时调用方零改动。
 */
import type { StoragePort } from './StoragePort';
import { AsyncStorageAdapter } from './AsyncStorageAdapter';

export type { StoragePort } from './StoragePort';
export { AsyncStorageAdapter } from './AsyncStorageAdapter';
export { MemoryStorageAdapter } from './MemoryStorageAdapter';

/** 生产默认：AsyncStorage。可在测试环境用 setStorage(new MemoryStorageAdapter()) 替换。 */
let _storage: StoragePort = new AsyncStorageAdapter();

export function getStorage(): StoragePort {
  return _storage;
}
export function setStorage(s: StoragePort): void {
  _storage = s;
}

export const storage: StoragePort = new Proxy({} as StoragePort, {
  get(_t, prop: keyof StoragePort) {
    return (_storage as any)[prop];
  },
});

/** 集中管理所有存储 key，避免散落字符串 */
export const StorageKeys = {
  API_KEY: 'app.settings.apiKey',
  PREFERRED_SOURCE: 'app.settings.preferredSource',
  WATCHLIST: 'app.watchlist',
  WATCHLIST_GROUPS: 'app.watchlist.groups',
  PORTFOLIO_HOLDINGS: 'app.portfolio.holdings',
  PORTFOLIO_SNAPSHOTS: 'app.portfolio.snapshots',
  QUOTE_CACHE_PREFIX: 'app.cache.quote.',
  KLINE_CACHE_PREFIX: 'app.cache.kline.',
  METHOD_CACHE_PREFIX: 'app.cache.mdc.',
  SIGNAL_PREFIX: 'app.signal.',
  SIGNAL_CONFIG: 'app.signal.config',
  STRATEGY_PROFILES: 'app.strategy.profiles',
  THEME_MODE: 'app.theme.mode',
  ALERT_HISTORY: 'app.alert.history',
  SEARCH_HISTORY: 'app.search.history',
} as const;
