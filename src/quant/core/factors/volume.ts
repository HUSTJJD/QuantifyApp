/**
 * 量比因子：当日成交量 / N 日均量。
 */
import { sma, volumes } from '@/quant/indicators';
import type { FactorDef, FactorResult } from '../types';

export const volumeRatioFactor: FactorDef = {
  id: 'volume_ratio',
  label: '量比',
  group: 'volume',
  params: [
    { key: 'maPeriod', label: '均量周期', default: 5, min: 2, max: 60, step: 1 },
    { key: 'threshold', label: '放量阈值', default: 1.5, min: 1, max: 10, step: 0.1 },
  ],
  evaluate(candles, params): FactorResult | null {
    const p = Math.max(2, Math.round(params.maPeriod ?? 5));
    const th = params.threshold ?? 1.5;
    if (candles.length < p + 1) return null;
    const v = volumes(candles);
    const ma = sma(v, p);
    const i = v.length - 1;
    const cur = v[i];
    const avg = ma[i];
    if (cur == null || avg == null || Number.isNaN(avg) || avg <= 0) return null;
    const ratio = cur / avg;
    if (ratio >= th) {
      return { score: 0.7, reason: `放量 ${ratio.toFixed(1)}x（≥${th}x）` };
    }
    if (ratio <= 1 / th) {
      return { score: -0.5, reason: `缩量 ${ratio.toFixed(2)}x` };
    }
    return { score: 0, reason: `量比 ${ratio.toFixed(2)}x` };
  },
};
