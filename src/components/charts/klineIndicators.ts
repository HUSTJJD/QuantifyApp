/**
 * K线技术指标纯函数计算（与 native-kline-view 示例一致）。
 *
 * 该原生图表库本身只负责绘制，所有指标必须由 JS 端算好再塞进 optionList.modelArray。
 * 这里集中实现，供本 App 所有 K线场景复用。
 *
 * 约定：
 *  - 输入数组按时间升序（旧 -> 新）；
 *  - 每条记录至少含 { open, high, low, close, vol }；
 *  - 返回新数组，不修改入参。
 */

export interface RawCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
}

/** 简单移动平均，前置不足周期时回退为 close 本身（与示例行为一致） */
export function sma(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out[i] = i >= period - 1 ? sum / period : values[i];
  }
  return out;
}

/** 主图 MA：返回固定长度的 maList（periods 指定长度），每个元素 { value, title } */
export function calcMA(candles: RawCandle[], periods: number[]): Array<{ value: number; title: string }>[] {
  const closes = candles.map((c) => c.close);
  return candles.map((_, i) =>
    periods.map((p) => ({
      value: sma(closes, p)[i],
      title: String(p),
    }))
  );
}

export function calcBOLL(candles: RawCandle[], n = 20, p = 2): Array<{ bollMb: number; bollUp: number; bollDn: number }> {
  const closes = candles.map((c) => c.close);
  return candles.map((_, i) => {
    if (i < n - 1) {
      const c = candles[i].close;
      return { bollMb: c, bollUp: c, bollDn: c };
    }
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += closes[j];
    const ma = sum / n;
    let variance = 0;
    for (let j = i - n + 1; j <= i; j++) variance += (closes[j] - ma) ** 2;
    const std = Math.sqrt(variance / (n - 1));
    return { bollMb: ma, bollUp: ma + p * std, bollDn: ma - p * std };
  });
}

export function calcMACD(candles: RawCandle[], s = 12, l = 26, m = 9): Array<{ macdDif: number; macdDea: number; macdValue: number }> {
  const closes = candles.map((c) => c.close);
  let emaS = closes[0];
  let emaL = closes[0];
  let dea = 0;
  return closes.map((_, i) => {
    if (i === 0) return { macdDif: 0, macdDea: 0, macdValue: 0 };
    emaS = (2 * closes[i] + (s - 1) * emaS) / (s + 1);
    emaL = (2 * closes[i] + (l - 1) * emaL) / (l + 1);
    const dif = emaS - emaL;
    dea = (2 * dif + (m - 1) * dea) / (m + 1);
    return { macdDif: dif, macdDea: dea, macdValue: 2 * (dif - dea) };
  });
}

export function calcKDJ(candles: RawCandle[], n = 9, m1 = 3, m2 = 3): Array<{ kdjK: number; kdjD: number; kdjJ: number }> {
  let k = 50;
  let d = 50;
  return candles.map((item, i) => {
    if (i === 0) return { kdjK: k, kdjD: d, kdjJ: 3 * k - 2 * d };
    const start = Math.max(0, i - n + 1);
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = start; j <= i; j++) {
      highest = Math.max(highest, candles[j].high);
      lowest = Math.min(lowest, candles[j].low);
    }
    const rsv = highest === lowest ? 50 : ((item.close - lowest) / (highest - lowest)) * 100;
    k = (rsv + (m1 - 1) * k) / m1;
    d = (k + (m1 - 1) * d) / m1;
    const j = m2 * k - 2 * d;
    return { kdjK: k, kdjD: d, kdjJ: j };
  });
}

export function calcRSI(candles: RawCandle[], periods: number[]): Array<{ value: number; index: number; title: string }>[] {
  return candles.map((_, i) => {
    const list = periods.map((p, index) => {
      if (i < p) return { value: 50, index, title: String(p) };
      let gains = 0;
      let losses = 0;
      for (let j = i - p + 1; j <= i; j++) {
        const change = candles[j].close - candles[j - 1].close;
        if (change > 0) gains += change;
        else losses += Math.abs(change);
      }
      const avgGain = gains / p;
      const avgLoss = losses / p;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      return { value: 100 - 100 / (1 + rs), index, title: String(p) };
    });
    return list;
  });
}

export function calcWR(candles: RawCandle[], periods: number[]): Array<{ value: number; index: number; title: string }>[] {
  return candles.map((item, i) => {
    return periods.map((p, index) => {
      if (i < p - 1) return { value: -50, index, title: String(p) };
      let highest = -Infinity;
      let lowest = Infinity;
      for (let j = i - p + 1; j <= i; j++) {
        highest = Math.max(highest, candles[j].high);
        lowest = Math.min(lowest, candles[j].low);
      }
      const wr = highest === lowest ? -50 : -((highest - item.close) / (highest - lowest)) * 100;
      return { value: wr, index, title: String(p) };
    });
  });
}
