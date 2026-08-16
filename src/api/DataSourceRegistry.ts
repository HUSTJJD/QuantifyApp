/**
 * 数据源注册表。各 adapter 加载时 register()；Client 经工厂取实例（默认缓存单例）。
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
const instances = new Map<string, MarketDataSource>();

export function register(
  id: string,
  label: string,
  factory: DataSourceFactory,
  builtin = false,
): void {
  if (registry.has(id) && registry.get(id)!.builtin && !builtin) {
    return;
  }
  registry.set(id, { id, label, factory, builtin });
}

export function unregister(id: string): void {
  registry.delete(id);
  instances.delete(id);
}

export function createSource(id: string): MarketDataSource {
  const entry = registry.get(id);
  if (!entry) {
    throw new DataSourceError(`未注册的数据源: ${id}`, id);
  }
  return entry.factory();
}

/** 进程内单例，避免每次请求 new FuyaoClient */
export function getSource(id: string): MarketDataSource {
  let inst = instances.get(id);
  if (!inst) {
    inst = createSource(id);
    instances.set(id, inst);
  }
  return inst;
}

export function listAvailableSources(): { id: string; label: string }[] {
  return [...registry.values()].map((e) => ({ id: e.id, label: e.label }));
}

export function hasSource(id: string): boolean {
  return registry.has(id);
}

export function resetSourceInstances(): void {
  instances.clear();
}
