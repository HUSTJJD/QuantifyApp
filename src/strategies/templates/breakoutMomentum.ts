/**
 * 突破动量：N 日新高 + 强放量 + 均线多头。
 * 适合强势股追涨。
 */
import type { StrategyTemplate } from '../types';

export const breakoutMomentumTemplate: StrategyTemplate = {
  id: 'breakout_momentum',
  label: '突破动量',
  description: 'N日新高突破 + 强放量 + 均线多头——右侧追涨，适合强势行情。',
  rules: [
    {
      mode: 'and',
      side: 'buy',
      strength: 2,
      reason: '突破动量：新高突破 + 强放量 + 均线多头',
      conditions: [
        { kind: 'triggered', factorId: 'breakout', side: 'buy' },
        { kind: 'score', factorId: 'volume_ratio', op: 'gt', value: 0.5 },
        { kind: 'score', factorId: 'ma_trend', op: 'gt', value: 0 },
      ],
    },
    {
      mode: 'or',
      side: 'sell',
      strength: 2,
      reason: '突破失败：跌破新低 或 均线空头',
      conditions: [
        { kind: 'triggered', factorId: 'breakout', side: 'sell' },
        { kind: 'score', factorId: 'ma_trend', op: 'lt', value: -0.5 },
      ],
    },
  ],
};
