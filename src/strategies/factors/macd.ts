/**
 * MACD 因子：DIF/DEA 交叉 + 柱体方向。
 */
import type { Candle } from '@/api';
import { macd, closes } from '@/quant/indicators';
import type { FactorDef, FactorResult } from '../types';

export const macdFactor: FactorDef = {
  id: 'macd',
  label: 'MACD',
  group: 'momentum',
  params: [
    { key: 'fast', label: '快线', default: 12, min: 2, max: 50, step: 1 },
    { key: 'slow', label: '慢线', default: 26, min: 5, max: 100, step: 1 },
    { key: 'signal', label: '信号线', default: 9, min: 2, max: 50, step: 1 },
  ],
  evaluate(candles, params): FactorResult | null {
    const fast = Math.round(params.fast ?? 12);
    const slow = Math.round(params.slow ?? 26);
    const sig = Math.round(params.signal ?? 9);
    if (candles.length < slow + sig + 2) return null;
    const { dif, dea, hist } = macd(closes(candles), fast, slow, sig);
    const i = dif.length - 1;
    const d = dif[i], e = dea[i], dp = dif[i - 1], ep = dea[i - 1], h = hist[i];
    if ([d, e, dp, ep, h].some((v) => v == null || Number.isNaN(v))) return null;
    if (dp <= ep && d > e) {
      return { score: 1, reason: 'MACD 金叉', triggered: true, triggerSide: 'buy' };
    }
    if (dp >= ep && d < e) {
      return { score: -1, reason: 'MACD 死叉', triggered: true, triggerSide: 'sell' };
    }
    const pos = h > 0 ? 0.4 : -0.4;
    return { score: pos, reason: h > 0 ? 'MACD 柱体为正' : 'MACD 柱体为负' };
  },
};
