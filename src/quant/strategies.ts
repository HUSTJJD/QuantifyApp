/**
 * 量化策略注册表（桥接层）。
 *
 * 策略一律以「多因子组合规则」表达（见 src/strategies/）。
 * 本文件把 StrategyTemplate 包装成旧引擎可用的 Strategy，
 * 供 SignalEngine / 回测 / 模拟盘统一调用。
 */
import type { Candle, Quote } from '@/api';
import { evaluateStrategy } from '@/strategies/engine';
import { STRATEGY_TEMPLATES, DEFAULT_TEMPLATE_ID } from '@/strategies/templates';
import type { StrategyTemplate } from '@/strategies/types';

export type SignalSide = 'buy' | 'sell' | 'hold';

/** 单策略输出的局部信号（strength 取值范围 -3~3，负为偏空）。 */
export interface PartialSignal {
  side: SignalSide;
  reason: string;
  strength: number;
}

export interface StrategyContext {
  /** 最新一笔实时行情（用于当日突破、涨跌幅判断），可为空 */
  quote?: Quote | null;
  /** 该策略的用户配置参数（覆盖 defaultParams） */
  params?: Record<string, number>;
}

export interface Strategy {
  id: string;
  label: string;
  /** 默认是否启用（仅默认模板启用） */
  enabledByDefault: boolean;
  /** 可选策略参数（因子参数覆盖，供 UI 调参） */
  defaultParams?: Record<string, number>;
  evaluate: (candles: Candle[], ctx: StrategyContext) => PartialSignal | null;
}

/** 把多因子模板包装成 Strategy */
function templateAsStrategy(tpl: StrategyTemplate): Strategy {
  return {
    id: tpl.id,
    label: tpl.label,
    enabledByDefault: tpl.id === DEFAULT_TEMPLATE_ID,
    evaluate: (candles: Candle[]): PartialSignal | null => {
      const sig = evaluateStrategy(tpl, candles);
      if (!sig) return null;
      return { side: sig.side, reason: sig.reason, strength: sig.strength };
    },
  };
}

/** 全部已注册策略（来自多因子模板） */
export const STRATEGIES: Strategy[] = STRATEGY_TEMPLATES.map(templateAsStrategy);

export interface StrategyConfig {
  enabled: Record<string, boolean>;
  /** 各策略的覆盖参数（可选），key 为策略 id */
  params?: Record<string, Record<string, number>>;
  /** 各策略的合并权重（可选，默认 1）；最终强度 = Σ(策略强度 × 权重) */
  weights?: Record<string, number>;
}

/** 取当前启用的策略（合并默认与用户配置），并把参数注入 context。 */
export function activeStrategies(cfg: StrategyConfig): Strategy[] {
  const enabled = STRATEGIES.filter((s) => cfg.enabled[s.id] ?? s.enabledByDefault);
  return enabled.map((s) => ({
    ...s,
    evaluate: (candles: Candle[], ctx: StrategyContext) =>
      s.evaluate(candles, { ...ctx, params: { ...s.defaultParams, ...cfg.params?.[s.id], ...ctx.params } }),
  }));
}
