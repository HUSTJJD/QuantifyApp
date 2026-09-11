/**
 * API 层运行配置。
 *
 * 源优先级配置：按顺序尝试，第一个成功的返回结果。
 * 业务层不手动切源；测试可通过 sourceOrder 覆盖。
 *
 * 默认优先级（官方主源决策）：
 *  fuyao    - 同花顺官方 SDK（主源：官方接口 + SDK 封装，能力覆盖最全；同花顺/扶摇同一 API）
 *  stock-sdk - StockSDK（兜底源：覆盖港股/美股/分钟K/盘口等）
 *
 * 说明：两源按「能力分区」协作而非互斥——partition 分源后，各源只拉自己支持的子集；
 * 主源网络故障时由 SourceRouter 自动熔断降级到兜底源。
 */
import type { Market } from './types';
import { storage, StorageKeys } from '@/data/db/storage';

export type DataSourceId = string;

export interface ApiConfig {
  /** 源尝试顺序（按优先级排列） */
  sourceOrder: readonly string[];
  timeoutMs: number;
}

/**
 * 默认源优先级：fuyao 官方主源 → stock-sdk 兜底 → dukascopy 全球指数补充。
 * dukascopy 仅覆盖映射表内的全球指数（USA500/USATECH/HKG…），不参与 A 股。
 */
export const DEFAULT_SOURCE_ORDER = ['fuyao', 'stock-sdk', 'longport', 'dukascopy'] as const;

export const defaultApiConfig: ApiConfig = {
  sourceOrder: [...DEFAULT_SOURCE_ORDER],
  timeoutMs: 10_000,
};

let activeConfig: ApiConfig = { ...defaultApiConfig, sourceOrder: [...DEFAULT_SOURCE_ORDER] };

export function getApiConfig(): ApiConfig {
  return activeConfig;
}

export function setApiConfig(patch: Partial<ApiConfig>): void {
  activeConfig = {
    ...activeConfig,
    ...patch,
    sourceOrder: patch.sourceOrder ? [...patch.sourceOrder] : activeConfig.sourceOrder,
  };
}

/** @deprecated 源由内部自动调度，保留仅为兼容旧存储回灌 */
export async function setUserPreferredSource(_id: DataSourceId): Promise<void> {
  await storage.setObject(StorageKeys.PREFERRED_SOURCE, { primary: _id });
}

export async function setUserApiKey(key: string): Promise<void> {
  await storage.setString(StorageKeys.API_KEY, key);
}

export async function getUserApiKey(): Promise<string | undefined> {
  return storage.getString(StorageKeys.API_KEY);
}

export function resolveUnifiedApiKey(injectedKey?: string): string | undefined {
  const envKey = process.env?.HITHINK_FINANCE_API_KEY;
  return injectedKey || envKey;
}

/**
 * 统一 API Key 存储（替代原 HithsaHttpClient 的静态 Key）。
 * 所有 fuyao / 同花顺 调用均从此处取，避免重复/硬编码 Key。
 */
let _unifiedApiKey: string | undefined;

/** 设置/清除全局默认 API Key（用户自设或统一环境变量注入）。 */
export function setUnifiedApiKey(key?: string): void {
  _unifiedApiKey = key;
}

/** 读取全局默认 API Key：优先注入值，其次统一环境变量 HITHINK_FINANCE_API_KEY。 */
export function getUnifiedApiKey(): string | undefined {
  return _unifiedApiKey ?? process.env?.HITHINK_FINANCE_API_KEY;
}

export async function applyUserPreferences(testKey?: string): Promise<void> {
  const savedKey = await getUserApiKey();
  if (savedKey) {
    setUnifiedApiKey(savedKey);
  } else {
    const unified = resolveUnifiedApiKey(testKey);
    if (unified) setUnifiedApiKey(unified);
  }
}

export const MARKET_LABELS: Record<Market, string> = {
  A: 'A股',
  HK: '港股通',
  US: '美股',
};
