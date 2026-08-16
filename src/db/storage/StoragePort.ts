/**
 * 存储抽象（端口 / Port）。
 *
 * 本 App 没有后端，所有数据（自选股、行情缓存、用户设置、API Key 等）都保存在
 * 用户自己的客户端。这一层把"用什么存储引擎"与业务解耦：业务只依赖 StoragePort，
 * 未来可无缝从 AsyncStorage 切换到 MMKV / 加密存储 / SQLite，无需改动调用方。
 */
export interface StoragePort {
  getString(key: string): Promise<string | undefined>;
  setString(key: string, value: string): Promise<void>;
  getObject<T>(key: string): Promise<T | undefined>;
  setObject<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  /** 以 key 前缀批量读取（用于缓存/列表场景），返回 [key, value] 列表 */
  getKeysByPrefix(prefix: string): Promise<string[]>;
}
