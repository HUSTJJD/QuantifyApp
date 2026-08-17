/**
 * API 层运行配置与用户偏好。
 *
 * 关键点（来自需求）：
 *  - 数据源优先级：同花顺 -> stock-api，但用户可以自由选择后端；
 *  - 同花顺 API Key 支持用户自己设置，绝不写死默认值；
 *  - 用户选择的"主数据源"与"Key"都持久化到本地存储（App 无后端，数据在客户端）。
 *
 * 本模块只持有运行时 config，真正的持久化在 storage 层；applyUserPreferences()
 * 在 App 启动时调用，把存储里的偏好回灌到运行时。
 */
import type { Market } from './types';
import { storage, StorageKeys } from '@/storage';
import { HithsaHttpClient } from './sources/HithsaHttpClient';

export type DataSourceId = 'hithsa' | 'stock-sdk' | 'stock-api' | 'fund-api' | (string & {});

export interface ApiConfig {
  /** 主数据源 id（用户可选；默认同花顺） */
  primary: DataSourceId;
  /** 第一备数据源 id（stock-api 兜底港股/分钟K/盘口）；传 null 关闭降级 */
  fallback: DataSourceId | null;
  /**
   * 额外备源链（按顺序追加在 fallback 之后，前置到 getOrderBook 之前）。
   * 用于 stock-sdk 这类「A股有真实五档盘口、港股/美股也能补行情」的二级兜底源。
   */
  extraFallbacks: DataSourceId[];
  /** 单个请求超时（毫秒） */
  timeoutMs: number;
}

export const defaultApiConfig: ApiConfig = {
  primary: 'hithsa',
  // 回退链顺序：同花顺(主) -> stock-sdk -> fund-api
  // 优先级按上游真实能力：同花顺 > stock-sdk > fund-api。
  //  - stock-sdk：补齐同花顺缺失的真实五档盘口、日/周/月 K、港股/美股行情、特色数据；
  //  - fund-api：专属基金全系能力兜底。
  // 注：npm 包 `stock-api` 是 Node/Browser 直连外网（腾讯/新浪/东方财富）的实时抓取库，
  //     依赖 Node 全局 fetch/Headers 且无 RN 适配，无法在 React Native 中运行，故不接入。
  fallback: 'stock-sdk',
  extraFallbacks: ['fund-api'],
  timeoutMs: 10_000,
};

let activeConfig: ApiConfig = { ...defaultApiConfig };

export function getApiConfig(): ApiConfig {
  return activeConfig;
}
export function setApiConfig(patch: Partial<ApiConfig>): void {
  activeConfig = { ...activeConfig, ...patch };
}

/** 用户可在 UI 选择主数据源；落盘到本地存储 */
export async function setUserPreferredSource(id: DataSourceId): Promise<void> {
  setApiConfig({ primary: id });
  await storage.setObject(StorageKeys.PREFERRED_SOURCE, { primary: id });
}

/** 设置同花顺 API Key（用户自填）；落盘到本地存储 */
export async function setUserApiKey(key: string): Promise<void> {
  await storage.setString(StorageKeys.API_KEY, key);
}

export async function getUserApiKey(): Promise<string | undefined> {
  return storage.getString(StorageKeys.API_KEY);
}

/**
 * 统一 API Key 来源解析（Skill 核心规则：所有接口复用同一把 Key，禁止重复/硬编码）。
 *
 * 解析顺序（后者不覆盖前者）：
 *   1. 用户在 UI 自设并落盘的 Key（最高优先级，运营态真实 Key）；
 *   2. 测试/CI 显式注入的 Key（applyUserPreferences(testKey)）；
 *   3. 用户级 credentials.env（HITHINK_FINANCE_API_KEY）——本目录统一保管的 Key；
 *   4. 进程环境变量 HITHINK_FINANCE_API_KEY（兜底，便于脚本/CI 复用同一把 Key）。
 *
 * 以上来源统一收敛到同一个变量语义（统一 API Key），hithsa 主源只从这一处读取。
 */
export function resolveUnifiedApiKey(injectedKey?: string): string | undefined {
  const envKey = process.env?.HITHINK_FINANCE_API_KEY;
  return injectedKey || envKey;
}

/**
 * App 启动时调用：把本地存储里的用户偏好回灌到运行时 config。
 * 若用户从未设置过，则维持默认值（同花顺优先）。
 *
 * @param testKey 可选：仅用于本地/CI 测试的 Key。一旦用户已在本地存储中
 *                设置过自己的 Key，则以用户设置为准，testKey 被忽略（测试 Key 不落盘）。
 */
export async function applyUserPreferences(testKey?: string): Promise<void> {
  const preferred = await storage.getObject<{ primary: DataSourceId }>(StorageKeys.PREFERRED_SOURCE);
  if (preferred?.primary) {
    activeConfig = { ...activeConfig, primary: preferred.primary };
  }
  const savedKey = await getUserApiKey();
  if (savedKey) {
    // 用户已自设 Key，优先使用
    HithsaHttpClient.setDefaultKey(savedKey);
  } else {
    // 未自设时复用统一 API Key（credentials.env / 进程环境变量），测试注入优先
    const unified = resolveUnifiedApiKey(testKey);
    if (unified) HithsaHttpClient.setDefaultKey(unified);
  }
}

/** 市场 -> 展示文案 */
export const MARKET_LABELS: Record<Market, string> = {
  A: 'A股',
  HK: '港股通',
  US: '美股',
};
