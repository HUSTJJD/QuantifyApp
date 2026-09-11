/**
 * 异动历史记录（M4 续：本地持久化 → 已迁移本地 SQLite）。
 *
 * 把 `detectAlerts` 产出的异动事件落盘，支持：
 *  - 去重：同一天、同标的、同规则只保留首条（避免轮询重复刷屏）
 *  - 回看：按时间倒序取最近 N 条
 *  - 清理：整表清空
 *
 * 双引擎：
 *  - SQLite 可用（真机）→ 写入 alert_event 表（行级 JSON payload），本地库为唯一数据源；
 *  - 不可用（jest / 未接入原生）→ 回落 AsyncStorage，仅保证单测行为与迁移前一致。
 *
 * 纯函数 `mergeAlertEvents` 负责去重合并，便于单测。
 */
import type { DB, Scalar } from '@op-engineering/op-sqlite';
import { storage, StorageKeys } from '@/data/db/storage';
import { getSqlite } from '@/data/db/connection';
import type { AlertEvent } from './alerts';

/** 历史记录上限：超过则丢弃最旧的。 */
export const ALERT_HISTORY_LIMIT = 200;

/** 单条历史记录 = 异动事件 + 落盘时的持久化时间戳。 */
export interface AlertHistoryEntry extends AlertEvent {
  /** 落盘时间戳（ms），与 AlertEvent.time 通常一致，用于回看排序。 */
  savedAt: number;
}

const SQL_SELECT = 'SELECT payload, saved_at FROM alert_event ORDER BY saved_at DESC';
const SQL_DELETE = 'DELETE FROM alert_event';
const SQL_INSERT =
  'INSERT INTO alert_event (payload, saved_at) VALUES (?, ?)';

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 去重键：同天 + 同标的 + 同规则 + 同类型。 */
export function dedupeKey(e: AlertEvent): string {
  return `${dayKey(e.time)}|${e.symbol.code}|${e.symbol.exchange}|${e.ruleId}|${e.type}`;
}

/**
 * 把新事件合并进既有历史，按去重键去重（已存在则跳过），并触发时间倒序。
 * 纯函数，不触碰存储；返回合并后的新数组（不修改入参）。
 */
export function mergeAlertEvents(
  existing: AlertHistoryEntry[],
  incoming: AlertEvent[],
  limit = ALERT_HISTORY_LIMIT,
): AlertHistoryEntry[] {
  const seen = new Set(existing.map(dedupeKey));
  const merged: AlertHistoryEntry[] = [...existing];
  for (const e of incoming) {
    const key = dedupeKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...e, savedAt: e.time });
  }
  // 时间倒序（新→旧），再截断到上限
  merged.sort((a, b) => b.savedAt - a.savedAt);
  return merged.slice(0, limit);
}

/** 从 op-sqlite 行里解析 payload JSON，坏行跳过。 */
async function rowsToEntries(db: DB): Promise<AlertHistoryEntry[]> {
  const res = await db.execute(SQL_SELECT);
  const out: AlertHistoryEntry[] = [];
  for (const r of (res.rows ?? []) as Record<string, Scalar>[]) {
    try {
      const v = JSON.parse(String(r.payload));
      if (v && typeof v === 'object') out.push(v as AlertHistoryEntry);
    } catch {
      // 单条坏数据跳过，不阻断整体读取
    }
  }
  return out;
}

/** 读取全部异动历史（倒序）。SQLite 可用时只读本地库（上线前不考虑历史兼容）。 */
export async function getAlertHistory(): Promise<AlertHistoryEntry[]> {
  const db = await getSqlite();
  if (!db) {
    const saved = await storage.getObject<AlertHistoryEntry[]>(StorageKeys.ALERT_HISTORY);
    return Array.isArray(saved) ? saved : [];
  }
  return rowsToEntries(db);
}

/** 写入（覆盖）异动历史。 */
export async function setAlertHistory(entries: AlertHistoryEntry[]): Promise<void> {
  const db = await getSqlite();
  if (!db) {
    await storage.setObject(StorageKeys.ALERT_HISTORY, entries);
    return;
  }
  await db.transaction(async (tx) => {
    await tx.execute(SQL_DELETE);
  });
  if (entries.length > 0) {
    await db.executeBatch([
      [
        SQL_INSERT,
        entries.map((e) => [JSON.stringify(e), e.savedAt] as Scalar[]),
      ],
    ]);
  }
}

/** 将一批新事件去重合并后落盘，返回最新的历史。 */
export async function recordAlerts(incoming: AlertEvent[]): Promise<AlertHistoryEntry[]> {
  const existing = await getAlertHistory();
  const next = mergeAlertEvents(existing, incoming);
  await setAlertHistory(next);
  return next;
}

/** 清空异动历史。 */
export async function clearAlertHistory(): Promise<void> {
  const db = await getSqlite();
  if (!db) {
    await storage.remove(StorageKeys.ALERT_HISTORY);
    return;
  }
  await db.execute(SQL_DELETE);
}
