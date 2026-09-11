/**
 * 多因子策略评估引擎。
 *
 * 输入 StrategyTemplate + K 线 → 产出 FactorSignal。
 * 纯函数；因子按需缓存（同一 factorId+params 只算一次）。
 */
import type { Candle } from '@/api';
import { getFactor } from './factors';
import { defaultFactorParams } from './types';
import type {
  FactorCondition,
  FactorResult,
  FactorSignal,
  StrategyRule,
  StrategyTemplate,
} from './types';

/** 因子缓存键：factorId + 稳定序列化 params */
function cacheKey(factorId: string, params: Record<string, number>): string {
  const keys = Object.keys(params).sort();
  return `${factorId}|${keys.map((k) => `${k}=${params[k]}`).join(',')}`;
}

function paramsOf(factorId: string, overrides?: Record<string, number>): Record<string, number> {
  const f = getFactor(factorId);
  if (!f) return overrides ?? {};
  return { ...defaultFactorParams(f), ...overrides };
}

/** 评估单个条件 */
function evalCondition(
  cond: FactorCondition,
  candles: Candle[],
  cache: Map<string, FactorResult | null>,
): boolean {
  const run = (id: string, p?: Record<string, number>): FactorResult | null => {
    const key = cacheKey(id, paramsOf(id, p));
    if (!cache.has(key)) {
      const f = getFactor(id);
      cache.set(key, f ? f.evaluate(candles, paramsOf(id, p)) : null);
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
      // 用左右因子的 score 差判断交叉：当前 left>right 且之前 left<=right
      // 简化：用两因子当前 score 的相对关系 + 至少一个 triggered
      const l = run(cond.left, cond.params?.[cond.left]);
      const r = run(cond.right, cond.params?.[cond.right]);
      if (l == null || r == null) return false;
      if (cond.direction === 'above') return l.score > r.score;
      return l.score < r.score;
    }
  }
}

function ruleHit(rule: StrategyRule, candles: Candle[], cache: Map<string, FactorResult | null>): boolean {
  if (rule.conditions.length === 0) return false;
  if (rule.mode === 'and') return rule.conditions.every((c) => evalCondition(c, candles, cache));
  return rule.conditions.some((c) => evalCondition(c, candles, cache));
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
): FactorSignal | null {
  const cache = new Map<string, FactorResult | null>();
  for (let i = 0; i < template.rules.length; i++) {
    const rule = template.rules[i];
    if (ruleHit(rule, candles, cache)) {
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
