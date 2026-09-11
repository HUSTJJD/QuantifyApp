/**
 * @deprecated 统一方法栏目表已迁至 `@/data/api/contract/catalog`（数量随 methods.ts 演进，当前 122 项），
 * 并由 Jest 契约测试与 App 内自检共用同一份，避免两套目录漂移。
 * 本文件仅保留转发，不再新增内容；请直接引用 `@/data/api/contract/catalog`。
 */
import { METHOD_CATALOG, type MethodCatalogEntry } from '@/data/api/contract/catalog';

export type { MethodGroupKey } from '@/data/api/contract/catalog';
export type SourceMethodDef = MethodCatalogEntry;

export { METHOD_GROUP_ORDER, METHOD_GROUP_TITLES } from '@/data/api/contract/catalog';

/** 全部方法目录项（完整 CatalogMap，与 methods.ts 同步） */
export const METHOD_DEFS: MethodCatalogEntry[] = Object.values(METHOD_CATALOG) as MethodCatalogEntry[];
