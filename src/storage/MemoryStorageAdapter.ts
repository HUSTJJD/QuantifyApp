/**
 * 内存存储适配器 —— 仅用于单元测试 / 无原生环境兜底。
 * 进程退出即丢失，不作为生产默认。
 */
import type { StoragePort } from './StoragePort';

export class MemoryStorageAdapter implements StoragePort {
  private map = new Map<string, string>();

  async getString(key: string): Promise<string | undefined> {
    return this.map.get(key);
  }

  async setString(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async getObject<T>(key: string): Promise<T | undefined> {
    const raw = this.map.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  async setObject<T>(key: string, value: T): Promise<void> {
    this.map.set(key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }

  async getKeysByPrefix(prefix: string): Promise<string[]> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }
}
