/**
 * 多因子策略框架 —— 类型契约。
 *
 * 框架三层：
 *   Factor（可调参的量化信号）
 *     → Rule（因子条件 AND/OR 组合）
 *       → StrategyTemplate（可持久化/回测的策略）
 *
 * 因子是纯函数：candles + params → score/triggered。
 * 策略只描述「怎么组合因子」，不内嵌指标计算。
 */
import type { Candle } from '@/data/api';

/* ------------------------------ 因子 ------------------------------ */

export type FactorGroup = 'trend' | 'momentum' | 'volume' | 'volatility';

export interface FactorParamDef {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface FactorResult {
  /** 归一化分数 [-1,1]：>0 偏多、<0 偏空、0 中性 */
  score: number;
  /** 可读原因 */
  reason: string;
  /** 事件型因子是否刚触发（交叉/突破） */
  triggered?: boolean;
  /** 触发方向（有 triggered 时有效） */
  triggerSide?: 'buy' | 'sell';
}

export interface FactorDef {
  id: string;
  label: string;
  group: FactorGroup;
  params: FactorParamDef[];
  /** 纯函数；数据不足返回 null */
  evaluate: (candles: Candle[], params: Record<string, number>) => FactorResult | null;
}

/** 取因子默认参数 */
export function defaultFactorParams(f: FactorDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of f.params) out[p.key] = p.default;
  return out;
}

/* ------------------------------ 规则 DSL ------------------------------ */

export type ScoreOp = 'gt' | 'lt' | 'gte' | 'lte';

export type FactorCondition =
  /** 因子分数与数值比较 */
  | {
      kind: 'score';
      factorId: string;
      params?: Record<string, number>;
      op: ScoreOp;
      value: number;
    }
  /** 事件型因子刚触发 */
  | {
      kind: 'triggered';
      factorId: string;
      params?: Record<string, number>;
      side: 'buy' | 'sell';
    }
  /** 两个因子分数交叉 */
  | {
      kind: 'cross';
      left: string;
      right: string;
      direction: 'above' | 'below';
      params?: Record<string, Record<string, number>>;
    };

export interface StrategyRule {
  mode: 'and' | 'or';
  conditions: FactorCondition[];
  side: 'buy' | 'sell';
  /** 默认 2 */
  strength?: number;
  reason?: string;
}

export interface StrategyTemplate {
  id: string;
  label: string;
  description: string;
  rules: StrategyRule[];
}

/* ------------------------------ 信号输出 ------------------------------ */

export type SignalSide = 'buy' | 'sell' | 'hold';

export interface FactorSignal {
  side: Exclude<SignalSide, 'hold'>;
  reason: string;
  strength: number;
  /** 命中的规则下标 */
  ruleIndex: number;
}
