/**
 * K 线数据有效性校验：在「数据源边界」统一把关，任何 NaN / 非有限数 / 价格关系异常
 * 的 K 线都不允许进入图表与指标计算，避免坏数据把原生 K 线图渲染坏（扁平/错位/NPE）。
 *
 * 校验原则（A 股日/周/月/分钟 K 线通用）：
 *  - datetime 必须能解析成有限且为正的时间戳；
 *  - open/high/low/close 必须是有限正数；
 *  - high >= max(open, close, low)，low <= min(open, close, high)（即 high>=low、high>=open、high>=close、low<=open、low<=close）；
 *  - volume 必须有限且 >= 0；amount（可选）若存在必须有限且 >= 0。
 */
import type { Candle } from './types';

export interface CandleValidity {
  valid: boolean;
  reasons: string[];
}

/** 单根 K 线校验，返回是否通过及不通过原因 */
export function checkCandle(c: Candle): CandleValidity {
  const reasons: string[] = [];

  // 时间
  const ts = typeof c.datetime === 'number' ? c.datetime : c.datetime != null ? new Date(c.datetime).getTime() : NaN;
  if (!Number.isFinite(ts) || ts <= 0) {
    reasons.push(`datetime 非法(${String(c.datetime)})`);
  }

  // 价格
  const priceFields: Array<[keyof Candle, number | undefined]> = [
    ['open', c.open],
    ['high', c.high],
    ['low', c.low],
    ['close', c.close],
  ];
  for (const [k, v] of priceFields) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      reasons.push(`${String(k)} 非法(${String(v)})`);
    }
  }

  // 成交量
  if (typeof c.volume !== 'number' || !Number.isFinite(c.volume) || c.volume < 0) {
    reasons.push(`volume 非法(${String(c.volume)})`);
  }

  // 成交额（可选）
  if (c.amount != null && (typeof c.amount !== 'number' || !Number.isFinite(c.amount) || c.amount < 0)) {
    reasons.push(`amount 非法(${String(c.amount)})`);
  }

  // 价格关系
  const { open, high, low, close } = c;
  if ([open, high, low, close].every((x) => typeof x === 'number' && Number.isFinite(x))) {
    if (high < low) reasons.push('high<low');
    if (high < open) reasons.push('high<open');
    if (high < close) reasons.push('high<close');
    if (low > open) reasons.push('low>open');
    if (low > close) reasons.push('low>close');
  }

  return { valid: reasons.length === 0, reasons };
}

export function isValidCandle(c: Candle): boolean {
  return checkCandle(c).valid;
}

/** 过滤掉无效 K 线，仅保留可通过校验的；空数组安全返回空数组 */
export function cleanCandles(list: Candle[] | null | undefined): Candle[] {
  if (!Array.isArray(list)) return [];
  return list.filter(isValidCandle);
}

/** 把任意上游行（可能字段类型杂乱）尽量规整成 Candle，再通过校验 */
export function toCandle(row: Record<string, unknown>): Candle | null {
  const num = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const open = num(row.open);
  const high = num(row.high);
  const low = num(row.low);
  const close = num(row.close);
  if (open == null || high == null || low == null || close == null) return null;
  const dt = row.datetime ?? row.date ?? row.time;
  if (dt == null) return null;
  const candle: Candle = {
    datetime: (typeof dt === 'number' || typeof dt === 'string' ? dt : String(dt)) as number | string,
    open,
    high,
    low,
    close,
    volume: num(row.volume) ?? 0,
    amount: num(row.amount) ?? undefined,
  };
  return isValidCandle(candle) ? candle : null;
}
