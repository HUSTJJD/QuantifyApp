/**
 * 数据源注册表（Registry）。
 *
 * 设计目标（来自需求）：API 层要支持"各种后端切换"，且后端可由用户自由选择。
 * 因此具体数据源不再硬编码在工厂 switch 里，而是：
 *   1. 各实现模块在加载时用 register() 自注册（见 HithsaApiSource / StockApiSource）；
 *   2. 运行时用户可在 UI 选择主数据源（setUserPreferredSource），偏好落到本地存储；
 *   3. MarketDataClient 完全通过本注册表解析 id -> 实例，未知 id 直接报错。
 *
 * 新增一个后端只需：实现 MarketDataSource，并调用 register('my-src', '我的源', factory)。
 */
import type { MarketDataSource } from './MarketDataSource';
import { DataSourceError } from './MarketDataSource';

export type DataSourceFactory = () => MarketDataSource;

interface RegistryEntry {
  id: string;
  label: string;
  factory: DataSourceFactory;
  builtin: boolean;
}

const registry = new Map<string, RegistryEntry>();

/** 注册一个数据源。builtin=true 表示框架内置源（不可被同名覆盖时静默忽略）。 */
export function register(
  id: string,
  label: string,
  factory: DataSourceFactory,
  builtin = false,
): void {
  if (registry.has(id) && registry.get(id)!.builtin && !builtin) {
    // 允许后注册覆盖用户/内置，但内置之间不互覆盖
    return;
  }
  registry.set(id, { id, label, factory, builtin });
}

/** 注销（一般用于测试） */
export function unregister(id: string): void {
  registry.delete(id);
}

/** 创建实例（每次取新实例，由 client 负责缓存单例） */
export function createSource(id: string): MarketDataSource {
  const entry = registry.get(id);
  if (!entry) {
    throw new DataSourceError(`未注册的数据源: ${id}`, id);
  }
  return entry.factory();
}

/** 当前所有可用数据源的元信息（用于 UI 渲染切换列表） */
export function listAvailableSources(): { id: string; label: string }[] {
  return [...registry.values()].map((e) => ({ id: e.id, label: e.label }));
}

/** 是否存在某数据源 */
export function hasSource(id: string): boolean {
  return registry.has(id);
}
