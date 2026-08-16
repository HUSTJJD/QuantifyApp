/**
 * 技术指标计算（纯函数）。
 * 仅依赖 Candle 序列，输入需按时间升序。结果数组与输入等长（前导不足处为 NaN）。
 * 这是「个人量化模块」的计算底座，后续可自行扩展更多指标。
 */
import type { Candle } from '@/api';

/** 简单移动平均。period<=0 时返回全 NaN。 */
export function sma(values: number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (period <= 0 || n < period) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 指数移动平均。alpha 默认 2/(period+1)。 */
export function ema(values: number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (period <= 0 || n === 0) return out;
  const alpha = 2 / (period + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < n; i++) {
    prev = values[i] * alpha + prev * (1 - alpha);
    out[i] = prev;
  }
  return out;
}

/** 相对强弱指标（Wilder 平滑）。返回 0~100，前导为 NaN。 */
export function rsi(values: number[], period = 14): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < n; i++) {
    const d = values[i] - values[i - 1];
    const g = d >= 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** MACD：返回 {dif, dea, hist}。默认(12,26,9)。 */
export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { dif: number[]; dea: number[]; hist: number[] } {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const dif = values.map((_, i) =>
    Number.isNaN(emaFast[i]) || Number.isNaN(emaSlow[i]) ? NaN : emaFast[i] - emaSlow[i],
  );
  const validDif = dif.filter((v) => !Number.isNaN(v));
  const deaArr = ema(validDif, signalPeriod);
  const dea = new Array<number>(dif.length).fill(NaN);
  let k = 0;
  for (let i = 0; i < dif.length; i++) {
    if (!Number.isNaN(dif[i])) dea[i] = deaArr[k++];
  }
  const hist = dif.map((v, i) => (Number.isNaN(v) || Number.isNaN(dea[i]) ? NaN : (v - dea[i]) * 2));
  return { dif, dea, hist };
}

/** KDJ（随机指标）。返回 {k, d, j}。默认(9,3,3)。 */
export function kdj(
  candles: Candle[],
  n = 9,
  kPeriod = 3,
  dPeriod = 3,
): { k: number[]; d: number[]; j: number[] } {
  const len = candles.length;
  const k = new Array<number>(len).fill(NaN);
  const d = new Array<number>(len).fill(NaN);
  const j = new Array<number>(len).fill(NaN);
  if (len < n) return { k, d, j };
  let prevK = 50;
  let prevD = 50;
  for (let i = n - 1; i < len; i++) {
    let low = Infinity;
    let high = -Infinity;
    for (let w = i - n + 1; w <= i; w++) {
      if (candles[w].low < low) low = candles[w].low;
      if (candles[w].high > high) high = candles[w].high;
    }
    const close = candles[i].close;
    const rsv = high === low ? 50 : ((close - low) / (high - low)) * 100;
    const curK = (prevK * (kPeriod - 1) + rsv) / kPeriod;
    const curD = (prevD * (dPeriod - 1) + curK) / dPeriod;
    k[i] = curK;
    d[i] = curD;
    j[i] = 3 * curK - 2 * curD;
    prevK = curK;
    prevD = curD;
  }
  return { k, d, j };
}

/** 从 K 线提取收盘价序列。 */
export function closes(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}
