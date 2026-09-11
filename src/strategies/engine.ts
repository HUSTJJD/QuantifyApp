/**
 * 多因子策略评估引擎。
 *
 * 输入 StrategyTemplate + K 线 → 产出 FactorSignal。
 * 纯函数；因子按需缓存（同一 factorId+params 只算一次）。
 * paramOverrides：按 factorId 覆盖因子默认参数（来自用户档案调参）。
 */
import type { Candle } from '@/data/api';
import { getFactor } from './factors';
import { defaultFactorParams } from './types';
import type {
  FactorCondition,
  FactorResult,
  FactorSignal,
  StrategyRule,
  StrategyTemplate,
} from './types';

/** 按因子 id 覆盖参数：{ ma_cross: { fast: 8 }, rsi: { period: 10 } } */
export type FactorParamOverrides = Record<string, Record<string, number>>;

function cacheKey(factorId: string, params: Record<string, number>): string {
  const keys = Object.keys(params).sort();
  return `${factorId}|${keys.map((k) => `${k}=${params[k]}`).join(',')}`;
}

function paramsOf(
  factorId: string,
  overrides?: Record<string, number>,
  all?: FactorParamOverrides,
): Record<string, number> {
  const f = getFactor(factorId);
  const base = f ? defaultFactorParams(f) : {};
  return { ...base, ...all?.[factorId], ...overrides };
}

function evalCondition(
  cond: FactorCondition,
  candles: Candle[],
  cache: Map<string, FactorResult | null>,
  paramOverrides?: FactorParamOverrides,
): boolean {
  const run = (id: string, p?: Record<string, number>): FactorResult | null => {
    const key = cacheKey(id, paramsOf(id, p, paramOverrides));
    if (!cache.has(key)) {
      const f = getFactor(id);
      cache.set(key, f ? f.evaluate(candles, paramsOf(id, p, paramOverrides)) : null);
    }
    return cache.get(key) ?? null;
  };

  switch (cond.kind) {
    case 'score': {
      const r = run(cond.factorId, cond.params);
      if (r == null) return false;
      switch (cond.op) {
        case 'gt': return r.score > cond.value;
        case 'lt': return r.score < cond.value;
        case 'gte': return r.score >= cond.value;
        case 'lte': return r.score <= cond.value;
      }
      return false;
    }
    case 'triggered': {
      const r = run(cond.factorId, cond.params);
      return r?.triggered === true && r.triggerSide === cond.side;
    }
    case 'cross': {
      const l = run(cond.left, cond.params?.[cond.left]);
      const r = run(cond.right, cond.params?.[cond.right]);
      if (l == null || r == null) return false;
      if (cond.direction === 'above') return l.score > r.score;
      return l.score < r.score;
    }
  }
}

function ruleHit(
  rule: StrategyRule,
  candles: Candle[],
  cache: Map<string, FactorResult | null>,
  paramOverrides?: FactorParamOverrides,
): boolean {
  if (rule.conditions.length === 0) return false;
  if (rule.mode === 'and') {
    return rule.conditions.every((c) => evalCondition(c, candles, cache, paramOverrides));
  }
  return rule.conditions.some((c) => evalCondition(c, candles, cache, paramOverrides));
}

function autoReason(rule: StrategyRule): string {
  const parts = rule.conditions.map((c) => {
    switch (c.kind) {
      case 'score':
        return `${c.factorId}${c.op}${c.value}`;
      case 'triggered':
        return `${c.factorId}触发${c.side}`;
      case 'cross':
        return `${c.left}${c.direction === 'above' ? '>' : '<'}${c.right}`;
    }
  });
  return `${rule.mode === 'and' ? '同时满足' : '满足任一'}：${parts.join('、')}`;
}

/**
 * 评估策略模板：命中第一条规则即返回信号；全部不命中返回 null。
 */
export function evaluateStrategy(
  template: StrategyTemplate,
  candles: Candle[],
  paramOverrides?: FactorParamOverrides,
): FactorSignal | null {
  const cache = new Map<string, FactorResult | null>();
  for (let i = 0; i < template.rules.length; i++) {
    const rule = template.rules[i];
    if (ruleHit(rule, candles, cache, paramOverrides)) {
      return {
        side: rule.side,
        reason: rule.reason ?? autoReason(rule),
        strength: rule.strength ?? 2,
        ruleIndex: i,
      };
    }
  }
  return null;
}

/** 收集模板用到的全部因子 id（去重） */
export function factorsUsedBy(template: StrategyTemplate): string[] {
  const ids = new Set<string>();
  for (const rule of template.rules) {
    for (const c of rule.conditions) {
      if (c.kind === 'score' || c.kind === 'triggered') ids.add(c.factorId);
      else {
        ids.add(c.left);
        ids.add(c.right);
      }
    }
  }
  return [...ids];
}
