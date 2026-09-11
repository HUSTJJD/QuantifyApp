/**
 * 回测结果缓存：按「数据维度 + 配置维度」哈希缓存 BacktestResult，
 * 进页先读缓存，避免每次全量重算（池回测可能数十标的）。
 *
 * SQLite 不可用时（jest / 无原生模块）回落进程内内存 Map，单测走内存路径。
 * 缓存键由调用方提供：dataKey 描述数据范围（池 + 周期 + 区间 + bar 数），
 * optsKey 描述回测配置（策略 + 选项）。两者任一变化即视为不同回测。
 */
import { getSqlite } from '@/data/db/connection';
import type { BacktestOptions, BacktestResult } from './backtest';

export interface BacktestCacheKeyInput {
  /** 数据维度（由调用方提供：池 + 周期 + 区间 + bar 数 + 末根时间） */
  dataKey: string;
  /** 配置维度（策略 + 回测选项归一化后的字符串） */
  optsKey: string;
}

/** 生成缓存键 */
export function backtestConfigKey(input: BacktestCacheKeyInput): string {
  return `bt:${input.dataKey}#${input.optsKey}`;
}

/** 从回测选项归一化出稳定的配置键（忽略函数/不定字段） */
export function backtestOptsKey(opts: BacktestOptions = {}): string {
  const norm = {
    initCash: opts.initCash ?? 100_000,
    positionRatio: opts.positionRatio ?? 1,
    lotSize: opts.lotSize ?? 100,
    strategyId: opts.strategyId ?? '',
    exit: opts.exit ?? null,
    cost: opts.cost ?? null,
    barsPerYear: opts.barsPerYear ?? 252,
    execution: opts.execution ?? 'close',
  };
  return JSON.stringify(norm);
}

const mem = new Map<string, string>();

/** 读取缓存；未命中或解析失败返回 null */
export async function getCachedBacktest(key: string): Promise<BacktestResult | null> {
  const db = await getSqlite();
  if (!db) {
    const raw = mem.get(key);
    return raw ? (JSON.parse(raw) as BacktestResult) : null;
  }
  try {
    const res = await db.execute('SELECT payload FROM backtest_cache WHERE key = ?', [key]);
    const row = (res.rows ?? [])[0] as { payload?: string } | undefined;
    if (!row?.payload) return null;
    return JSON.parse(row.payload) as BacktestResult;
  } catch {
    return null;
  }
}

/** 写入缓存（INSERT OR REPLACE） */
export async function putCachedBacktest(key: string, result: BacktestResult): Promise<void> {
  const payload = JSON.stringify(result);
  const db = await getSqlite();
  if (!db) {
    mem.set(key, payload);
    return;
  }
  try {
    await db.execute(
      'INSERT OR REPLACE INTO backtest_cache (key, payload, created_at) VALUES (?, ?, ?)',
      [key, payload, Date.now()],
    );
  } catch {
    // 写入失败不阻断主流程
  }
}

/** 清空缓存（配置重大变更或用户手动清除时调用） */
export async function clearBacktestCache(): Promise<void> {
  const db = await getSqlite();
  if (!db) {
    mem.clear();
    return;
  }
  try {
    await db.execute('DELETE FROM backtest_cache');
  } catch {
    // ignore
  }
}
