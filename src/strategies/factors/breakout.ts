/**
 * 突破因子：收盘创 N 日新高/新低。
 */
import type { Candle } from '@/api';
import { closes, highs, lows } from '@/quant/indicators';
import type { FactorDef, FactorResult } from '../types';

export const breakoutFactor: FactorDef = {
  id: 'breakout',
  label: 'N日突破',
  group: 'trend',
  params: [
    { key: 'days', label: '窗口天数', default: 20, min: 5, max: 120, step: 1 },
  ],
  evaluate(candles, params): FactorResult | null {
    const n = Math.max(5, Math.round(params.days ?? 20));
    if (candles.length < n + 2) return null;
    const c = closes(candles);
    const h = highs(candles);
    const l = lows(candles);
    const i = c.length - 1;
    const last = c[i];
    const prevHigh = Math.max(...h.slice(i - n, i));
    const prevLow = Math.min(...l.slice(i - n, i));
    if (last > prevHigh) {
      return { score: 1, reason: `突破${n}日新高`, triggered: true, triggerSide: 'buy' };
    }
    if (last < prevLow) {
      return { score: -1, reason: `跌破${n}日新低`, triggered: true, triggerSide: 'sell' };
    }
    return { score: 0, reason: '区间震荡' };
  },
};
