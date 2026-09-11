/**
 * 趋势确认：MA金叉 + MACD偏多 + RSI未超买 + 放量。
 * 适合 A 股日线中长线趋势跟随。
 */
import type { StrategyTemplate } from '../types';

export const trendConfirmTemplate: StrategyTemplate = {
  id: 'trend_confirm',
  label: '趋势确认',
  description: 'MA金叉、MACD确认、RSI过滤假突破、放量验证——多因子共振，适合趋势市。',
  rules: [
    {
      mode: 'and',
      side: 'buy',
      strength: 2,
      reason: '趋势确认：MA金叉 + MACD偏多 + RSI<60 + 放量',
      conditions: [
        { kind: 'triggered', factorId: 'ma_cross', side: 'buy' },
        { kind: 'score', factorId: 'macd', op: 'gt', value: 0 },
        { kind: 'score', factorId: 'rsi', op: 'lt', value: -0.3 },
        { kind: 'score', factorId: 'volume_ratio', op: 'gte', value: 0.3 },
      ],
    },
    {
      mode: 'or',
      side: 'sell',
      strength: 2,
      reason: '趋势结束：MA死叉 或 RSI超买',
      conditions: [
        { kind: 'triggered', factorId: 'ma_cross', side: 'sell' },
        { kind: 'score', factorId: 'rsi', op: 'lte', value: -0.5 },
      ],
    },
  ],
};
