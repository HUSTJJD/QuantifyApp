/**
 * AsyncStorage 适配器 —— 基于 @react-native-async-storage/async-storage 的默认实现。
 *
 * 选它原因：RN 官方事实标准、跨平台、零额外原生引擎依赖（模板已含基础 pod 配置）。
 * 若日后需要更高性能/同步 API，可新增 MMKVAdapter 并注册到 storageRegistry，业务无感。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StoragePort } from './StoragePort';

export class AsyncStorageAdapter implements StoragePort {
  async getString(key: string): Promise<string | undefined> {
    const v = await AsyncStorage.getItem(key);
    return v ?? undefined;
  }

  async setString(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, value);
  }

  async getObject<T>(key: string): Promise<T | undefined> {
    const raw = await this.getString(key);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async setObject<T>(key: string, value: T): Promise<void> {
    await this.setString(key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  }

  async getKeysByPrefix(prefix: string): Promise<string[]> {
    const keys = await AsyncStorage.getAllKeys();
    return keys.filter((k) => typeof k === 'string' && k.startsWith(prefix)) as string[];
  }
}
