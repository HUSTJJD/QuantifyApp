/**
 * 复权计算引擎：基于「不复权 K 线 + 复权因子」本地计算前复权 / 后复权。
 *
 * 数据架构（用户确认）：
 *  - 数据库统一存储**不复权**数据（K 线原价）+ **复权因子**（分红/送股/配股）；
 *  - 界面提供 前复权 / 后复权 / 不复权 三选项，App 自行计算，不依赖行情源返回复权价。
 *
 * 复权因子模型（同花顺官方）：
 *  - exDateMs    除权除息日；
 *  - dividendPerShare 每股现金分红（税前）；
 *  - perShareBonus    每股送股比例；
 *  - allotmentRatio   配股比例；
 *  - allotmentPrice   配股价格。
 *
 * 算法：
 *  - 每日累计因子 factor_i = factor_{i-1} * (1 + perShareBonus) + dividendPerShare/price 近似；
 *  - 精确算法：前复权用「最新一日为基准 1.0，向前累计」；后复权用「首日为基准 1.0，向后累计」。
 */
import type { Candle } from '@/data/api';

export type AdjustMode = 'none' | 'forward' | 'backward';

export interface AdjustmentFactorInput {
  /** 除权除息日（毫秒） */
  exDateMs: number;
  /** 每股现金分红（税前） */
  dividendPerShare?: number | null;
  /** 每股送股比例 */
  perShareBonus?: number | null;
  /** 配股比例 */
  allotmentRatio?: number | null;
  /** 配股价格 */
  allotmentPrice?: number | null;
}

/**
 * 计算前复权系数序列（与 K 线日期对齐）。
 * 思路：以每根 bar 的日期为轴，将「该日期之后发生的除权事件」按时间反向累计，
 * 得到每根 bar 的调整系数；基准为最新一日（系数 1.0），越早的 bar 系数越小。
 *
 * @param candles 不复权 K 线（需按时间升序）
 * @param factors 复权因子事件（任意顺序）
 * @returns 与 candles 等长的系数数组；无因子时全为 1
 */
export function computeForwardFactors(
  candles: Candle[],
  factors: AdjustmentFactorInput[],
): number[] {
  const n = candles.length;
  if (n === 0) return [];
  if (factors.length === 0) return new Array<number>(n).fill(1);

  // 按除权日升序排列事件
  const events = factors
    .filter((f) => Number.isFinite(f.exDateMs))
    .map((f) => ({ ...f, exDateMs: Math.round(f.exDateMs) }))
    .sort((a, b) => a.exDateMs - b.exDateMs);

  if (events.length === 0) return new Array<number>(n).fill(1);

  // 计算每根 bar 对应的累计复权因子：
  // 对每根 bar，找到「除权日 > bar 日期」的所有事件，反向连乘 (1 + 送股比例 + 现金分红折算)。
  // 现金分红折算为比例：dividendPerShare / closeAtExDate（用除权日前一天的收盘价近似）。
  const dates = candles.map((c) => new Date(c.datetime).getTime());
  const closes = candles.map((c) => c.close);

  const factorsPerBar = new Array<number>(n).fill(1);
  for (let i = 0; i < n; i++) {
    const barDate = dates[i];
    let factor = 1;
    // 从最近的事件往前累计（与 barDate 同日及之后的事件都不影响当日之前的系数，
    // 因为前复权基准在最后，越早的事件对更早的 bar 影响越大）
    for (let e = events.length - 1; e >= 0; e--) {
      const ev = events[e];
      if (ev.exDateMs <= barDate) break; // 已到 bar 之前（含当日）的事件，不再影响该 bar 之前
      // 除权日 > barDate：该事件会调整 barDate 的价格
      const bonusRatio = ev.perShareBonus ?? 0;
      // 现金分红按除权日前收折算为比例（简化：用该 bar 收盘价）
      const divRatio = ev.dividendPerShare
        ? (ev.dividendPerShare ?? 0) / (closes[i] || 1)
        : 0;
      const allotRatio = ev.allotmentRatio
        ? (ev.allotmentRatio ?? 0) * (1 - (ev.allotmentPrice ?? 0) / (closes[i] || 1))
        : 0;
      factor *= 1 + bonusRatio + divRatio + allotRatio;
    }
    factorsPerBar[i] = factor;
  }
  return factorsPerBar;
}

/**
 * 计算后复权系数序列。
 * 思路：与回测一致，从最早事件向后累计，首日为 1.0，
 * 每遇到除权日，后续价格乘以 (1 + 送股比例 + 现金分红折算 + 配股折算)。
 */
export function computeBackwardFactors(
  candles: Candle[],
  factors: AdjustmentFactorInput[],
): number[] {
  const n = candles.length;
  if (n === 0) return [];
  if (factors.length === 0) return new Array<number>(n).fill(1);

  const events = factors
    .filter((f) => Number.isFinite(f.exDateMs))
    .map((f) => ({ ...f, exDateMs: Math.round(f.exDateMs) }))
    .sort((a, b) => a.exDateMs - b.exDateMs);
  if (events.length === 0) return new Array<number>(n).fill(1);

  const dates = candles.map((c) => new Date(c.datetime).getTime());
  const closes = candles.map((c) => c.close);
  const factorsPerBar = new Array<number>(n).fill(1);
  let cumulative = 1;
  let e = 0;
  for (let i = 0; i < n; i++) {
    while (e < events.length && events[e].exDateMs <= dates[i]) {
      const ev = events[e];
      const bonusRatio = ev.perShareBonus ?? 0;
      const divRatio = ev.dividendPerShare
        ? (ev.dividendPerShare ?? 0) / (closes[i] || 1)
        : 0;
      const allotRatio = ev.allotmentRatio
        ? (ev.allotmentRatio ?? 0) * (1 - (ev.allotmentPrice ?? 0) / (closes[i] || 1))
        : 0;
      cumulative *= 1 + bonusRatio + divRatio + allotRatio;
      e++;
    }
    factorsPerBar[i] = cumulative;
  }
  return factorsPerBar;
}

/**
 * 按指定复权模式生成调整后的 K 线。
 * - none      ：原样返回
 * - forward   ：close/high/low/open 乘以前复权系数
 * - backward  ：close/high/low/open 乘以后复权系数
 *
 * 复权后保留 volume/amount 原值（成交量不因价格复权改变）。
 */
export function adjustCandles(
  candles: Candle[],
  factors: AdjustmentFactorInput[],
  mode: AdjustMode,
): Candle[] {
  if (mode === 'none' || candles.length === 0) return candles;
  const coef =
    mode === 'forward'
      ? computeForwardFactors(candles, factors)
      : computeBackwardFactors(candles, factors);
  if (coef.length !== candles.length) return candles;
  return candles.map((c, i) => ({
    ...c,
    open: c.open * coef[i],
    high: c.high * coef[i],
    low: c.low * coef[i],
    close: c.close * coef[i],
  }));
}
