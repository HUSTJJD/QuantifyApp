/**
 * 超卖反弹：RSI 超卖 + 放量 + 价格站上 MA20。
 * 适合震荡市抢反弹。
 */
import type { StrategyTemplate } from '../types';

export const oversoldBounceTemplate: StrategyTemplate = {
  id: 'oversold_bounce',
  label: '超卖反弹',
  description: 'RSI 深度超卖 + 放量 + 价格站上 MA20——左侧抄底，适合震荡市。',
  rules: [
    {
      mode: 'and',
      side: 'buy',
      strength: 2,
      reason: '超卖反弹：RSI超卖 + 放量 + 多头排列不空',
      conditions: [
        { kind: 'score', factorId: 'rsi', op: 'gt', value: 0.5 },
        { kind: 'score', factorId: 'volume_ratio', op: 'gt', value: 0.3 },
        { kind: 'score', factorId: 'ma_trend', op: 'gte', value: -0.5 },
      ],
    },
    {
      mode: 'or',
      side: 'sell',
      strength: 2,
      reason: '反弹结束：RSI超买 或 跌破均线',
      conditions: [
        { kind: 'score', factorId: 'rsi', op: 'lte', value: -0.5 },
        { kind: 'score', factorId: 'ma_trend', op: 'lt', value: -0.5 },
      ],
    },
  ],
};
