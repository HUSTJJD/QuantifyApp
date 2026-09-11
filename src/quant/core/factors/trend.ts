/**
 * 均线排列因子：多头排列偏多、空头排列偏空。
 */
import { sma, closes } from '@/quant/indicators';
import type { FactorDef, FactorResult } from '../types';

export const maTrendFactor: FactorDef = {
  id: 'ma_trend',
  label: '均线排列',
  group: 'trend',
  params: [
    { key: 'p1', label: '短周期', default: 5, min: 2, max: 60, step: 1 },
    { key: 'p2', label: '中周期', default: 10, min: 3, max: 120, step: 1 },
    { key: 'p3', label: '长周期', default: 20, min: 5, max: 250, step: 1 },
  ],
  evaluate(candles, params): FactorResult | null {
    const p1 = Math.max(2, Math.round(params.p1 ?? 5));
    const p2 = Math.max(p1 + 1, Math.round(params.p2 ?? 10));
    const p3 = Math.max(p2 + 1, Math.round(params.p3 ?? 20));
    if (candles.length < p3 + 1) return null;
    const c = closes(candles);
    const a = sma(c, p1), b = sma(c, p2), d = sma(c, p3);
    const i = c.length - 1;
    const ma1 = a[i], ma2 = b[i], ma3 = d[i];
    if ([ma1, ma2, ma3].some((v) => v == null || Number.isNaN(v))) return null;
    if (ma1 > ma2 && ma2 > ma3) {
      return { score: 0.8, reason: `均线多头排列 MA${p1}>MA${p2}>MA${p3}` };
    }
    if (ma1 < ma2 && ma2 < ma3) {
      return { score: -0.8, reason: `均线空头排列 MA${p1}<MA${p2}<MA${p3}` };
    }
    return { score: 0, reason: '均线纠缠' };
  },
};
