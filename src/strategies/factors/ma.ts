/**
 * 均线交叉因子：MA fast 上穿/下穿 MA slow。
 * score：金叉 +1，死叉 -1，其余 0；triggered 标记事件。
 */
import type { Candle } from '@/api';
import { sma, closes } from '@/quant/indicators';
import type { FactorDef, FactorResult } from '../types';

export const maCrossFactor: FactorDef = {
  id: 'ma_cross',
  label: '均线交叉',
  group: 'trend',
  params: [
    { key: 'fast', label: '快线周期', default: 5, min: 2, max: 60, step: 1 },
    { key: 'slow', label: '慢线周期', default: 20, min: 5, max: 250, step: 1 },
  ],
  evaluate(candles: Candle[], params): FactorResult | null {
    const fastP = Math.max(2, Math.round(params.fast ?? 5));
    const slowP = Math.max(fastP + 1, Math.round(params.slow ?? 20));
    if (candles.length < slowP + 2) return null;
    const c = closes(candles);
    const fast = sma(c, fastP);
    const slow = sma(c, slowP);
    const i = c.length - 1;
    const f = fast[i], s = slow[i], fp = fast[i - 1], sp = slow[i - 1];
    if ([f, s, fp, sp].some((v) => v == null || Number.isNaN(v))) return null;
    if (fp <= sp && f > s) {
      return { score: 1, reason: `MA${fastP} 上穿 MA${slowP}（金叉）`, triggered: true, triggerSide: 'buy' };
    }
    if (fp >= sp && f < s) {
      return { score: -1, reason: `MA${fastP} 下穿 MA${slowP}（死叉）`, triggered: true, triggerSide: 'sell' };
    }
    // 非交叉：用相对位置给弱信号
    const pos = f > s ? 0.3 : -0.3;
    return { score: pos, reason: f > s ? '快线在慢线上方' : '快线在慢线下方' };
  },
};
