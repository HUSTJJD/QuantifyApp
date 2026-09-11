/**
 * API 层运行配置。
 *
 * 源优先级配置：按顺序尝试，第一个成功的返回结果。
 * 业务层不手动切源；测试可通过 sourceOrder 覆盖。
 *
 * 默认优先级（官方主源决策）：
 *  fuyao    - 同花顺官方 SDK（主源：官方接口 + SDK 封装，能力覆盖最全）
 *  hithsa   - 同花顺官方 REST（次主源：覆盖北交所 BJ + 同花顺板块指数 .TI 等 fuyao 未覆盖部分）
 *  stock-sdk - StockSDK（兜底源：覆盖港股/美股/分钟K/盘口等）
 *
 * 说明：三源按「能力分区」协作而非互斥——partition 分源后，各源只拉自己支持的子集；
 * 主源网络故障时由 SourceRouter 自动熔断降级到次主源/兜底源。
 */
import type { Market } from './types';
import { storage, StorageKeys } from '@/db/storage';
import { HithsaHttpClient } from './sources/HithsaHttpClient';

export type DataSourceId = string;

export interface ApiConfig {
  /** 源尝试顺序（按优先级排列） */
  sourceOrder: readonly string[];
  timeoutMs: number;
}

/** 默认源优先级：fuyao 官方主源 → hithsa 次主源（补 BJ/.TI）→ stock-sdk 兜底 */
export const DEFAULT_SOURCE_ORDER = ['fuyao', 'hithsa', 'stock-sdk'] as const;

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

export async function applyUserPreferences(testKey?: string): Promise<void> {
  const savedKey = await getUserApiKey();
  if (savedKey) {
    HithsaHttpClient.setDefaultKey(savedKey);
  } else {
    const unified = resolveUnifiedApiKey(testKey);
    if (unified) HithsaHttpClient.setDefaultKey(unified);
  }
}

export const MARKET_LABELS: Record<Market, string> = {
  A: 'A股',
  HK: '港股通',
  US: '美股',
};
