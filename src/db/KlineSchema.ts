/**
 * K 线数据库 Schema —— 行级数据模型与表/索引定义。
 *
 * 设计目标：把"整段 JSON 缓存"升级为"行级数据库"，让盯盘同屏多标的时：
 *  - 读取按 symbol+period 精准取数，不再 JSON.parse 全量大数组；
 *  - 增量写入（upsert）只落变化的那根 bar，避免整段回写；
 *  - 区间切片（getRange）可直接取最近 N 根 / 某时间窗，减少内存占用。
 *
 * 这里的模型与具体存储引擎无关；引擎（AsyncStorage 临时实现 / 原生 SQLite 后续接入）
 * 只要实现 KlineDatabasePort 即可，业务层零改动。
 */
import type { Candle, KlinePeriod, Symbol } from '@/api';

/** 归一化后的标的键（如 SH.600519），作为表行分区键 */
export type SymbolKey = string;

/** 单根 K 线在数据库中的行模型（所有时间统一为毫秒时间戳） */
export interface KlineRow {
  /** 分区键：exchange.code，例如 SH.600519 */
  symbol: SymbolKey;
  /** 周期：day/week/month/1m/... */
  period: KlinePeriod;
  /** 该根 bar 的起始时间（毫秒），作为行内唯一键 part of (symbol, period, ts) */
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** 成交量（股） */
  volume: number;
  /** 成交额（元），缺省 0 */
  amount: number;
  /** 写入/更新时间（毫秒），用于过期与冲突解决 */
  updatedAt: number;
}

/** 把 Symbol 归一化为稳定分区键 */
export function symbolKey(symbol: Symbol): SymbolKey {
  return `${symbol.exchange}.${symbol.code}`;
}

/** 把 Candle.datetime（number | string）统一为毫秒时间戳 */
export function toTs(datetime: number | string): number {
  return typeof datetime === 'number' ? datetime : Date.parse(datetime);
}

/** Candle[] -> KlineRow[]（按 time+symbol+period 标注） */
export function candlesToRows(
  symbol: Symbol,
  period: KlinePeriod,
  candles: Candle[],
  now: number = Date.now(),
): KlineRow[] {
  const sk = symbolKey(symbol);
  return candles.map((c) => ({
    symbol: sk,
    period,
    ts: toTs(c.datetime),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume ?? 0,
    amount: c.amount ?? 0,
    updatedAt: now,
  }));
}

/** KlineRow[] -> Candle[]（按 ts 升序） */
export function rowsToCandles(rows: KlineRow[]): Candle[] {
  return rows
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .map((r) => ({
      datetime: r.ts,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
      amount: r.amount,
    }));
}

/** 数据库版本（schema 变更时 +1，触发迁移/重建） */
export const KLINE_DB_VERSION = 1;

/** 单标的单周期最大保留行数（防止无限堆积；超出后保留最近 keep 根） */
export const KLINE_MAX_ROWS_PER_SERIES = 2000;
