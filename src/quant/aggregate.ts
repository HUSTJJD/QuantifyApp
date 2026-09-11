/**
 * K 线周期聚合：由日 K 在本地聚合出周 K / 月 K（用户确认：周/月 K 本地自己计算）。
 *
 * 规则（与主流行情软件一致）：
 *  - 周 K：周一 ~ 周五为一根（A 股交易日历）；跨年仍按连续周，最后一根不足 5 日也算一根；
 *  - 月 K：自然月为一根；
 *  - OHLC：open 取首日开盘，high 取区间最高，low 取区间最低，close 取末日收盘；
 *  - volume / amount：区间求和。
 *
 * 输入须为**不复权**日 K（按时间升序）；聚合结果同样是不复权级别，
 * 若需复权展示，配合 adjustment.adjustCandles 在聚合后/前统一处理。
 */
import type { Candle, KlinePeriod } from '@/data/api';

/** 按周（周一为起点）聚合成周 K */
export function aggregateWeekly(candles: Candle[]): Candle[] {
  return aggregateBy(candles, (ts) => {
    const d = new Date(ts);
    const day = d.getDay() === 0 ? 7 : d.getDay(); // 周日=7
    const delta = day - 1; // 周一=0
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - delta);
    return start.getTime();
  });
}

/** 按自然月聚合成月 K */
export function aggregateMonthly(candles: Candle[]): Candle[] {
  return aggregateBy(candles, (ts) => {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
}

/** 通用分组聚合 */
function aggregateBy(candles: Candle[], keyOf: (ts: number) => number): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curKey = -1;

  for (const c of candles) {
    const ts = new Date(c.datetime).getTime();
    if (!Number.isFinite(ts)) continue;
    const k = keyOf(ts);
    if (cur === null || k !== curKey) {
      if (cur) out.push(cur);
      cur = { datetime: ts, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0, amount: c.amount ?? 0 };
      curKey = k;
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume = (cur.volume ?? 0) + (c.volume ?? 0);
      cur.amount = (cur.amount ?? 0) + (c.amount ?? 0);
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 按目标周期聚合：day 原样；week -> 周 K；month -> 月 K；分钟级不支持（返回原样） */
export function aggregateByPeriod(candles: Candle[], period: KlinePeriod): Candle[] {
  if (period === 'week') return aggregateWeekly(candles);
  if (period === 'month') return aggregateMonthly(candles);
  return candles;
}
