/**
 * 布林带因子：价格在带内的相对位置；触及上下轨给信号。
 */
import { bollinger, closes } from '@/quant/indicators';
import type { FactorDef, FactorResult } from '../types';

export const bollingerFactor: FactorDef = {
  id: 'bollinger',
  label: '布林带',
  group: 'volatility',
  params: [
    { key: 'period', label: '周期', default: 20, min: 5, max: 100, step: 1 },
    { key: 'k', label: '带宽倍数', default: 2, min: 1, max: 4, step: 0.1 },
  ],
  evaluate(candles, params): FactorResult | null {
    const period = Math.max(5, Math.round(params.period ?? 20));
    const k = params.k ?? 2;
    if (candles.length < period + 2) return null;
    const c = closes(candles);
    const { upper, lower, mid } = bollinger(c, period, k);
    const i = c.length - 1;
    const last = c[i];
    const u = upper[i], l = lower[i], m = mid[i];
    if ([u, l, m].some((v) => v == null || Number.isNaN(v))) return null;
    if (u <= l) return null;
    if (last >= u) {
      return { score: -0.6, reason: `触及布林上轨(${u.toFixed(2)})` };
    }
    if (last <= l) {
      return { score: 0.6, reason: `触及布林下轨(${l.toFixed(2)})` };
    }
    // 带内位置：-1(下轨) ~ +1(上轨)，中性反转为偏多/偏空
    const pos = (last - m) / (u - m);
    return { score: -pos * 0.3, reason: `布林带内位置 ${pos.toFixed(2)}` };
  },
};
