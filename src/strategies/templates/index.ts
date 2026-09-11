/**
 * 内置策略模板注册表。
 */
import type { StrategyTemplate } from '../types';
import { trendConfirmTemplate } from './trendConfirm';
import { oversoldBounceTemplate } from './oversoldBounce';
import { breakoutMomentumTemplate } from './breakoutMomentum';

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  trendConfirmTemplate,
  oversoldBounceTemplate,
  breakoutMomentumTemplate,
];

/** 默认启用的模板 */
export const DEFAULT_TEMPLATE_ID = 'trend_confirm';

const byId = new Map(STRATEGY_TEMPLATES.map((t) => [t.id, t]));

export function getTemplate(id: string): StrategyTemplate | undefined {
  return byId.get(id);
}

export { trendConfirmTemplate, oversoldBounceTemplate, breakoutMomentumTemplate };
