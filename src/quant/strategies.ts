/**
 * 量化策略注册表。
 *
 * 设计约定：策略一律以「组合规则」表达（见 composite.ts），
 * 注册表只保留一个精心内置的策略；用户自定义 CompositeStrategyDef 可后续扩展。
 *
 * 单指标策略已移除——单指标噪音大、假信号多，不适合直接当交易依据。
 */
import type { Candle, Quote } from '@/api';

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
  /** 默认是否启用 */
  enabledByDefault: boolean;
  /** 可选策略参数（如均线周期），可被用户配置覆盖 */
  defaultParams?: Record<string, number>;
  evaluate: (candles: Candle[], ctx: StrategyContext) => PartialSignal | null;
}

/**
 * 把组合规则模板包装成 Strategy，供信号引擎 / 回测统一调用。
 * composite 只依赖 indicators + 本文件类型，延迟 require 避免循环依赖。
 */
function compositePresetsAsStrategies(): Strategy[] {
  const { evaluateComposite, COMPOSITE_PRESETS } = require('./composite') as typeof import('./composite');
  return COMPOSITE_PRESETS.map((def) => ({
    id: def.id,
    label: def.label,
    enabledByDefault: true,
    evaluate: (candles: Candle[], _ctx: StrategyContext): PartialSignal | null =>
      evaluateComposite(def, candles),
  }));
}

/** 唯一内置策略：趋势确认（多指标 AND/OR）。 */
export const STRATEGIES: Strategy[] = compositePresetsAsStrategies();

export interface StrategyConfig {
  enabled: Record<string, boolean>;
  /** 各策略的覆盖参数（可选），key 为策略 id */
  params?: Record<string, Record<string, number>>;
  /** 各策略的合并权重（可选，默认 1），key 为策略 id；最终强度 = Σ(策略强度 × 权重) */
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
