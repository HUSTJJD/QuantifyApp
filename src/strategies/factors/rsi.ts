/**
 * RSI 因子：超卖偏多、超买偏空；阈值可调。
 */
import type { Candle } from '@/api';
import { rsi, closes } from '@/quant/indicators';
import type { FactorDef, FactorResult } from '../types';

export const rsiFactor: FactorDef = {
  id: 'rsi',
  label: 'RSI',
  group: 'momentum',
  params: [
    { key: 'period', label: '周期', default: 14, min: 2, max: 50, step: 1 },
    { key: 'buy', label: '买入阈值', default: 30, min: 5, max: 50, step: 1 },
    { key: 'sell', label: '卖出阈值', default: 70, min: 50, max: 95, step: 1 },
  ],
  evaluate(candles, params): FactorResult | null {
    const period = Math.max(2, Math.round(params.period ?? 14));
    const buy = params.buy ?? 30;
    const sell = params.sell ?? 70;
    if (candles.length < period + 2) return null;
    const r = rsi(closes(candles), period);
    const v = r[r.length - 1];
    if (v == null || Number.isNaN(v)) return null;
    if (v < buy) {
      return { score: 0.8, reason: `RSI 超卖(${v.toFixed(0)}<${buy})` };
    }
    if (v > sell) {
      return { score: -0.8, reason: `RSI 超买(${v.toFixed(0)}>${sell})` };
    }
    // 中性区间：线性映射到 [-0.3, 0.3]（50 为 0）
    const mid = (buy + sell) / 2;
    const score = Math.max(-0.3, Math.min(0.3, (mid - v) / 20));
    return { score, reason: `RSI ${v.toFixed(0)}` };
  },
};
