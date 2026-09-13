/**
 * 完整技术指标套件（移植自 kline-charts-react utils/indicators，适配 RN）。
 *
 * 约定：
 * - 输入按时间升序（旧 → 新）
 * - OHLCV 字段可为 null（缺失 tick）
 * - 输出与输入等长；不足周期处为 null
 */

export interface OHLCV {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume?: number | null;
}

export interface MAResult {
  [key: string]: number | null;
}

export interface MACDResult {
  dif: number | null;
  dea: number | null;
  macd: number | null;
}

export interface BOLLResult {
  mid: number | null;
  upper: number | null;
  lower: number | null;
  bandwidth: number | null;
}

export interface KDJResult {
  k: number | null;
  d: number | null;
  j: number | null;
}

export interface RSIResult {
  [key: string]: number | null;
}

export interface WRResult {
  [key: string]: number | null;
}

export interface BIASResult {
  [key: string]: number | null;
}

export interface CCIResult {
  cci: number | null;
}

export interface ATRResult {
  tr: number | null;
  atr: number | null;
}

export interface OBVResult {
  obv: number | null;
  obvMa: number | null;
}

export interface ROCResult {
  roc: number | null;
  signal: number | null;
}

export interface DMIResult {
  pdi: number | null;
  mdi: number | null;
  adx: number | null;
  adxr: number | null;
}

export interface SARResult {
  sar: number | null;
  trend: 1 | -1 | null;
  ep: number | null;
  af: number | null;
}

export interface KCResult {
  mid: number | null;
  upper: number | null;
  lower: number | null;
  width: number | null;
}

function closesOf(data: OHLCV[]): (number | null)[] {
  return data.map((d) => d.close);
}

export function calcSMA(data: (number | null)[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (value != null) {
      sum += value;
      count++;
    }
    if (i >= period) {
      const old = data[i - period];
      if (old != null) {
        sum -= old;
        count--;
      }
    }
    result.push(i >= period - 1 && count === period ? sum / period : null);
  }
  return result;
}

export function calcEMA(data: (number | null)[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let ema: number | null = null;
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (value == null) {
      result.push(ema);
      continue;
    }
    ema = ema === null ? value : value * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

export function calcWMA(data: (number | null)[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const weights = Array.from({ length: period }, (_, i) => i + 1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    let valid = 0;
    for (let j = 0; j < period; j++) {
      const value = data[i - period + 1 + j];
      if (value != null) {
        sum += value * weights[j]!;
        valid++;
      }
    }
    result.push(valid === period ? sum / weightSum : null);
  }
  return result;
}

export function calcMA(
  closes: (number | null)[],
  options: { periods?: number[]; type?: 'sma' | 'ema' | 'wma' } = {},
): MAResult[] {
  const { periods = [5, 10, 20, 30, 60], type = 'sma' } = options;
  const arrays: Record<string, (number | null)[]> = {};
  for (const period of periods) {
    const key = `ma${period}`;
    arrays[key] =
      type === 'ema'
        ? calcEMA(closes, period)
        : type === 'wma'
          ? calcWMA(closes, period)
          : calcSMA(closes, period);
  }
  return closes.map((_, i) => {
    const item: MAResult = {};
    for (const key of Object.keys(arrays)) {
      item[key] = arrays[key]?.[i] ?? null;
    }
    return item;
  });
}

export function calcMACD(
  closes: (number | null)[],
  options: { short?: number; long?: number; signal?: number } = {},
): MACDResult[] {
  const { short = 12, long = 26, signal = 9 } = options;
  const emaShort = calcEMA(closes, short);
  const emaLong = calcEMA(closes, long);
  const dif: (number | null)[] = closes.map((_, i) => {
    const s = emaShort[i];
    const l = emaLong[i];
    return s != null && l != null ? s - l : null;
  });
  const dea = calcEMA(dif, signal);
  return closes.map((_, i) => {
    const d = dif[i] ?? null;
    const de = dea[i] ?? null;
    return {
      dif: d,
      dea: de,
      macd: d != null && de != null ? (d - de) * 2 : null,
    };
  });
}

export function calcBOLL(
  closes: (number | null)[],
  options: { period?: number; stdDev?: number } = {},
): BOLLResult[] {
  const { period = 20, stdDev = 2 } = options;
  const ma = calcSMA(closes, period);
  return closes.map((_, i) => {
    const mid = ma[i];
    if (mid == null || i < period - 1) {
      return { mid: null, upper: null, lower: null, bandwidth: null };
    }
    let sum = 0;
    let count = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const value = closes[j];
      if (value != null) {
        sum += (value - mid) ** 2;
        count++;
      }
    }
    if (count !== period) {
      return { mid, upper: null, lower: null, bandwidth: null };
    }
    const std = Math.sqrt(sum / period);
    const upper = mid + stdDev * std;
    const lower = mid - stdDev * std;
    return {
      mid,
      upper,
      lower,
      bandwidth: mid !== 0 ? ((upper - lower) / mid) * 100 : null,
    };
  });
}

export function calcKDJ(
  data: OHLCV[],
  options: { period?: number; kPeriod?: number; dPeriod?: number } = {},
): KDJResult[] {
  const { period = 9, kPeriod = 3, dPeriod = 3 } = options;
  const result: KDJResult[] = [];
  let prevK = 50;
  let prevD = 50;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push({ k: null, d: null, j: null });
      continue;
    }
    let highN = -Infinity;
    let lowN = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      const item = data[j];
      if (item?.high != null) highN = Math.max(highN, item.high);
      if (item?.low != null) lowN = Math.min(lowN, item.low);
    }
    const close = data[i]?.close;
    if (close == null || highN === -Infinity || lowN === Infinity) {
      result.push({ k: null, d: null, j: null });
      continue;
    }
    const rsv = highN === lowN ? 50 : ((close - lowN) / (highN - lowN)) * 100;
    const k = (prevK * (kPeriod - 1) + rsv) / kPeriod;
    const d = (prevD * (dPeriod - 1) + k) / dPeriod;
    const j = 3 * k - 2 * d;
    result.push({ k, d, j });
    prevK = k;
    prevD = d;
  }
  return result;
}

export function calcRSI(
  closes: (number | null)[],
  options: { periods?: number[] } = {},
): RSIResult[] {
  const { periods = [6, 12, 24] } = options;
  const arrays: Record<string, (number | null)[]> = {};
  for (const period of periods) {
    const rsi: (number | null)[] = [];
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 0; i < closes.length; i++) {
      const current = closes[i];
      const prev = closes[i - 1];
      if (i === 0 || current == null || prev == null) {
        rsi.push(null);
        continue;
      }
      const change = current - prev;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? -change : 0;
      if (i < period) {
        avgGain += gain;
        avgLoss += loss;
        rsi.push(null);
      } else if (i === period) {
        avgGain = (avgGain + gain) / period;
        avgLoss = (avgLoss + loss) / period;
        rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
      } else {
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
      }
    }
    arrays[`rsi${period}`] = rsi;
  }
  return closes.map((_, i) => {
    const item: RSIResult = {};
    for (const key of Object.keys(arrays)) {
      item[key] = arrays[key]?.[i] ?? null;
    }
    return item;
  });
}

export function calcWR(data: OHLCV[], options: { periods?: number[] } = {}): WRResult[] {
  const { periods = [6, 10] } = options;
  const arrays: Record<string, (number | null)[]> = {};
  for (const period of periods) {
    const wr: (number | null)[] = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        wr.push(null);
        continue;
      }
      let highN = -Infinity;
      let lowN = Infinity;
      for (let j = i - period + 1; j <= i; j++) {
        const item = data[j];
        if (item?.high != null) highN = Math.max(highN, item.high);
        if (item?.low != null) lowN = Math.min(lowN, item.low);
      }
      const close = data[i]?.close;
      wr.push(
        close == null || highN === lowN
          ? null
          : ((highN - close) / (highN - lowN)) * -100,
      );
    }
    arrays[`wr${period}`] = wr;
  }
  return data.map((_, i) => {
    const item: WRResult = {};
    for (const key of Object.keys(arrays)) {
      item[key] = arrays[key]?.[i] ?? null;
    }
    return item;
  });
}

export function calcBIAS(
  closes: (number | null)[],
  options: { periods?: number[] } = {},
): BIASResult[] {
  const { periods = [6, 12, 24] } = options;
  const arrays: Record<string, (number | null)[]> = {};
  for (const period of periods) {
    const ma = calcSMA(closes, period);
    arrays[`bias${period}`] = closes.map((close, i) => {
      const m = ma[i];
      return close == null || m == null || m === 0 ? null : ((close - m) / m) * 100;
    });
  }
  return closes.map((_, i) => {
    const item: BIASResult = {};
    for (const key of Object.keys(arrays)) {
      item[key] = arrays[key]?.[i] ?? null;
    }
    return item;
  });
}

export function calcCCI(data: OHLCV[], options: { period?: number } = {}): CCIResult[] {
  const { period = 14 } = options;
  const tp: (number | null)[] = data.map((item) => {
    if (item.high == null || item.low == null || item.close == null) return null;
    return (item.high + item.low + item.close) / 3;
  });
  const maTp = calcSMA(tp, period);
  return data.map((_, i) => {
    const tpVal = tp[i];
    const maTpVal = maTp[i];
    if (i < period - 1 || tpVal == null || maTpVal == null) return { cci: null };
    let sum = 0;
    let count = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const t = tp[j];
      if (t != null) {
        sum += Math.abs(t - maTpVal);
        count++;
      }
    }
    const md = count > 0 ? sum / count : 0;
    return { cci: md === 0 ? 0 : (tpVal - maTpVal) / (0.015 * md) };
  });
}

export function calcATR(data: OHLCV[], options: { period?: number } = {}): ATRResult[] {
  const { period = 14 } = options;
  const result: ATRResult[] = [];
  const trList: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (item?.high == null || item.low == null || item.close == null) {
      trList.push(null);
      result.push({ tr: null, atr: null });
      continue;
    }
    let tr: number;
    if (i === 0) {
      tr = item.high - item.low;
    } else {
      const prevClose = data[i - 1]?.close;
      tr =
        prevClose == null
          ? item.high - item.low
          : Math.max(
              item.high - item.low,
              Math.abs(item.high - prevClose),
              Math.abs(item.low - prevClose),
            );
    }
    trList.push(tr);
    if (i < period - 1) {
      result.push({ tr, atr: null });
    } else if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += trList[j] ?? 0;
      result.push({ tr, atr: sum / period });
    } else {
      const prevAtr = result[i - 1]?.atr;
      result.push({
        tr,
        atr: prevAtr == null ? null : (prevAtr * (period - 1) + tr) / period,
      });
    }
  }
  return result;
}

export function calcOBV(data: OHLCV[], options: { maPeriod?: number } = {}): OBVResult[] {
  const { maPeriod = 30 } = options;
  const result: OBVResult[] = [];
  let obv = 0;
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (item?.close == null || item.volume == null) {
      result.push({ obv: null, obvMa: null });
      continue;
    }
    if (i === 0) {
      obv = item.volume;
    } else {
      const prevClose = data[i - 1]?.close;
      if (prevClose == null) obv = item.volume;
      else if (item.close > prevClose) obv += item.volume;
      else if (item.close < prevClose) obv -= item.volume;
    }
    result.push({ obv, obvMa: null });
  }
  const obvMa = calcSMA(
    result.map((r) => r.obv),
    maPeriod,
  );
  for (let i = 0; i < result.length; i++) {
    result[i]!.obvMa = obvMa[i] ?? null;
  }
  return result;
}

export function calcROC(
  closes: (number | null)[],
  options: { period?: number; signalPeriod?: number } = {},
): ROCResult[] {
  const { period = 12, signalPeriod = 6 } = options;
  const roc: (number | null)[] = closes.map((current, i) => {
    const prev = closes[i - period];
    if (i < period || current == null || prev == null || prev === 0) return null;
    return ((current - prev) / prev) * 100;
  });
  const signal = calcEMA(roc, signalPeriod);
  return closes.map((_, i) => ({
    roc: roc[i] ?? null,
    signal: signal[i] ?? null,
  }));
}

export function calcDMI(
  data: OHLCV[],
  options: { period?: number; adxPeriod?: number } = {},
): DMIResult[] {
  const { period = 14, adxPeriod = 14 } = options;
  const result: DMIResult[] = [];
  const trList: number[] = [];
  const plusDMList: number[] = [];
  const minusDMList: number[] = [];
  const dxList: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (item?.high == null || item.low == null || item.close == null) {
      result.push({ pdi: null, mdi: null, adx: null, adxr: null });
      dxList.push(null);
      continue;
    }

    let tr: number;
    if (i === 0) {
      tr = item.high - item.low;
    } else {
      const prevClose = data[i - 1]?.close;
      tr =
        prevClose == null
          ? item.high - item.low
          : Math.max(
              item.high - item.low,
              Math.abs(item.high - prevClose),
              Math.abs(item.low - prevClose),
            );
    }
    trList.push(tr);

    if (i === 0) {
      plusDMList.push(0);
      minusDMList.push(0);
    } else {
      const prev = data[i - 1];
      if (prev?.high == null || prev.low == null) {
        plusDMList.push(0);
        minusDMList.push(0);
      } else {
        const upMove = item.high - prev.high;
        const downMove = prev.low - item.low;
        plusDMList.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDMList.push(downMove > upMove && downMove > 0 ? downMove : 0);
      }
    }

    if (i < period - 1) {
      result.push({ pdi: null, mdi: null, adx: null, adxr: null });
      dxList.push(null);
      continue;
    }

    let smoothTR = 0;
    let smoothPlusDM = 0;
    let smoothMinusDM = 0;
    for (let j = i - period + 1; j <= i; j++) {
      smoothTR += trList[j] ?? 0;
      smoothPlusDM += plusDMList[j] ?? 0;
      smoothMinusDM += minusDMList[j] ?? 0;
    }

    const pdi = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    const mdi = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
    const diSum = pdi + mdi;
    const dx = diSum > 0 ? (Math.abs(pdi - mdi) / diSum) * 100 : 0;
    dxList.push(dx);

    let adx: number | null = null;
    if (i >= period - 1 + adxPeriod - 1) {
      let dxSum = 0;
      for (let j = i - adxPeriod + 1; j <= i; j++) dxSum += dxList[j] ?? 0;
      adx = dxSum / adxPeriod;
    }

    let adxr: number | null = null;
    if (adx != null && i >= period - 1 + adxPeriod - 1 + adxPeriod) {
      const prevAdx = result[i - adxPeriod]?.adx;
      if (prevAdx != null) adxr = (adx + prevAdx) / 2;
    }

    result.push({ pdi, mdi, adx, adxr });
  }

  return result;
}

export function calcSAR(
  data: OHLCV[],
  options: { afStart?: number; afIncrement?: number; afMax?: number } = {},
): SARResult[] {
  const { afStart = 0.02, afIncrement = 0.02, afMax = 0.2 } = options;
  const result: SARResult[] = [];
  if (data.length === 0) return result;

  let trend: 1 | -1 = 1;
  let sar = data[0]?.low ?? 0;
  let ep = data[0]?.high ?? 0;
  let af = afStart;

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (item?.high == null || item.low == null) {
      result.push({ sar: null, trend: null, ep: null, af: null });
      continue;
    }
    if (i === 0) {
      result.push({ sar: item.low, trend: 1, ep: item.high, af: afStart });
      sar = item.low;
      ep = item.high;
      trend = 1;
      af = afStart;
      continue;
    }

    sar = sar + af * (ep - sar);

    if (trend === 1) {
      const p1 = data[i - 1];
      const p2 = data[i - 2];
      if (p1?.low != null) sar = Math.min(sar, p1.low);
      if (p2?.low != null) sar = Math.min(sar, p2.low);
      if (item.low < sar) {
        trend = -1;
        sar = ep;
        ep = item.low;
        af = afStart;
      } else if (item.high > ep) {
        ep = item.high;
        af = Math.min(af + afIncrement, afMax);
      }
    } else {
      const p1 = data[i - 1];
      const p2 = data[i - 2];
      if (p1?.high != null) sar = Math.max(sar, p1.high);
      if (p2?.high != null) sar = Math.max(sar, p2.high);
      if (item.high > sar) {
        trend = 1;
        sar = ep;
        ep = item.high;
        af = afStart;
      } else if (item.low < ep) {
        ep = item.low;
        af = Math.min(af + afIncrement, afMax);
      }
    }

    result.push({ sar, trend, ep, af });
  }

  return result;
}

export function calcKC(
  data: OHLCV[],
  options: { emaPeriod?: number; atrPeriod?: number; multiplier?: number } = {},
): KCResult[] {
  const { emaPeriod = 20, atrPeriod = 10, multiplier = 2 } = options;
  const ema = calcEMA(closesOf(data), emaPeriod);
  const atr = calcATR(data, { period: atrPeriod });
  return data.map((_, i) => {
    const mid = ema[i];
    const atrVal = atr[i]?.atr;
    if (mid == null || atrVal == null) {
      return { mid: null, upper: null, lower: null, width: null };
    }
    const upper = mid + multiplier * atrVal;
    const lower = mid - multiplier * atrVal;
    return {
      mid,
      upper,
      lower,
      width: mid !== 0 ? ((upper - lower) / mid) * 100 : null,
    };
  });
}

/** 把 App 的 Candle[] 转成指标输入 */
export function toOHLCV(
  candles: Array<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  }>,
): OHLCV[] {
  return candles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume ?? 0,
  }));
}
