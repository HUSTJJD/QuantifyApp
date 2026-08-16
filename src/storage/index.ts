/**
 * 存储层统一出口（Barrel）+ 默认实例。
 * 业务层只 import { storage } from '@/storage'。
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
  QUOTE_CACHE_PREFIX: 'app.cache.quote.',
  KLINE_CACHE_PREFIX: 'app.cache.kline.',
  SIGNAL_PREFIX: 'app.signal.',
  SIGNAL_CONFIG: 'app.signal.config',
  THEME_MODE: 'app.theme.mode',
} as const;
