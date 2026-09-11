/**
 * 个股技术指标叠加层：把 K 线序列转换为图表可叠加的指标数据。
 * 纯函数，依赖 quant/indicators 的计算底座，仅做"序列 → 叠加结构"的适配与对齐。
 * 所有指标数组与输入 K 线等长；前导不足处为 NaN（图表层可据此跳过绘制）。
 */
import type { Candle } from '@/data/api';
import { sma, ema, macd, kdj, bollinger, rsi, volumes, closes } from '@/quant/indicators';

/** 单条指标线（与 K 线等长，前导为 NaN）。 */
export interface IndicatorLine {
  values: number[];
}

/** 多条同组指标线（如 BOLL 上中下轨）。 */
export interface IndicatorBand {
  upper: number[];
  mid: number[];
  lower: number[];
}

/** 叠加指标集合：供图表层一次性消费。 */
export interface IndicatorOverlay {
  /** 多条移动均线，如 MA5/MA10/MA20/MA60。 */
  mas: { period: number; line: IndicatorLine }[];
  /** MACD 三值。 */
  macd: { dif: number[]; dea: number[]; hist: number[] };
  /** KDJ 三值。 */
  kdj: { k: number[]; d: number[]; j: number[] };
  /** 布林带。 */
  boll: IndicatorBand;
  /** RSI（默认 14）。 */
  rsi: IndicatorLine;
  /** 成交量（与 K 线等长）。 */
  volume: number[];
}

export interface OverlayOptions {
  /** 需要计算的均线周期，默认 [5, 10, 20, 60]。 */
  maPeriods?: number[];
  /** 布林带参数，默认 (20, 2)。 */
  boll?: { period: number; k: number };
  /** RSI 周期，默认 14。 */
  rsiPeriod?: number;
}

/**
 * 计算个股 K 线的叠加指标。
 * 输入须按时间升序；closes/volumes 直接从 Candle 提取。
 */
export function buildIndicatorOverlay(candles: Candle[], opts: OverlayOptions = {}): IndicatorOverlay {
  const closeArr = closes(candles);
  const maPeriods = opts.maPeriods ?? [5, 10, 20, 60];
  const bollOpt = opts.boll ?? { period: 20, k: 2 };
  const rsiPeriod = opts.rsiPeriod ?? 14;

  const mas = maPeriods.map((period) => ({
    period,
    line: { values: sma(closeArr, period) },
  }));

  const macdRes = macd(closeArr);
  const kdjRes = kdj(candles);
  const bollRes = bollinger(closeArr, bollOpt.period, bollOpt.k);

  return {
    mas,
    macd: { dif: macdRes.dif, dea: macdRes.dea, hist: macdRes.hist },
    kdj: { k: kdjRes.k, d: kdjRes.d, j: kdjRes.j },
    boll: { upper: bollRes.upper, mid: bollRes.mid, lower: bollRes.lower },
    rsi: { values: rsi(closeArr, rsiPeriod) },
    volume: volumes(candles),
  };
}

/** 取指定周期均线的数值数组（找不到返回空数组，便于安全调用）。 */
export function maLine(overlay: IndicatorOverlay, period: number): number[] {
  return overlay.mas.find((m) => m.period === period)?.line.values ?? [];
}

/** EMA 均线（常用于中长周期趋势，如 MA120/EMA）。 */
export function emaLine(candles: Candle[], period: number): number[] {
  return ema(closes(candles), period);
}

/** 判断某根 K 线位置指标是否有效（非 NaN）。 */
export function isIndicatorValid(v: number): boolean {
  return typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v);
}
