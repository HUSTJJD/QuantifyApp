/**
 * 组合策略引擎：多指标条件 AND/OR 组合，摆脱「单指标一把梭」。
 *
 * 设计：
 *  1. IndicatorSnapshot：从 K 线一次算出全部可用指标；
 *  2. Condition：单条件（指标 op 阈值 / 交叉）；
 *  3. CompositeRule：一组条件 + AND/OR → 买卖；
 *  4. evaluateComposite：任一规则命中即产出 PartialSignal。
 *
 * 纯函数，可单测；与现有单指标 Strategy 并存，可被 profile/回测复用。
 */
import type { Candle } from '@/api';
import { sma, ema, macd, rsi, bollinger, closes, volumes, highs, lows } from './indicators';
import type { PartialSignal, SignalSide } from './strategies';

/* ------------------------------ 指标快照 ------------------------------ */

/** 可在规则里引用的指标键 */
export type IndicatorKey =
  | 'close'
  | 'open'
  | 'high'
  | 'low'
  | 'volume'
  | 'ma5' | 'ma10' | 'ma20' | 'ma60'
  | 'ema12' | 'ema26'
  | 'rsi14'
  | 'macd_dif' | 'macd_dea' | 'macd_hist'
  | 'boll_upper' | 'boll_lower'
  | 'high20' | 'low20'
  | 'vol_ma5';

export interface IndicatorSnapshot {
  /** 最新一根的指标值；指标未就绪为 null */
  get(key: IndicatorKey): number | null;
  /** 前一根（用于交叉判断） */
  prev(key: IndicatorKey): number | null;
  /** 最新收盘价 */
  close: number;
}

const nan = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function buildSnapshot(candles: Candle[]): IndicatorSnapshot | null {
  const n = candles.length;
  if (n < 2) return null;
  const c = closes(candles);
  const v = volumes(candles);
  const h = highs(candles);
  const l = lows(candles);

  const ma5 = sma(c, 5);
  const ma10 = sma(c, 10);
  const ma20 = sma(c, 20);
  const ma60 = sma(c, 60);
  const e12 = ema(c, 12);
  const e26 = ema(c, 26);
  const r = rsi(c, 14);
  const { dif, dea, hist } = macd(c);
  const bb = bollinger(c, 20, 2);
  const volMa = sma(v, 5);

  const hi20 = n >= 20 ? Math.max(...h.slice(-20)) : null;
  const lo20 = n >= 20 ? Math.min(...l.slice(-20)) : null;

  const table: Record<IndicatorKey, { cur: number | null; prev: number | null }> = {
    close: { cur: nan(c[n - 1]), prev: nan(c[n - 2]) },
    open: { cur: nan(candles[n - 1].open), prev: nan(candles[n - 2].open) },
    high: { cur: nan(h[n - 1]), prev: nan(h[n - 2]) },
    low: { cur: nan(l[n - 1]), prev: nan(l[n - 2]) },
    volume: { cur: nan(v[n - 1]), prev: nan(v[n - 2]) },
    ma5: { cur: nan(ma5[n - 1]), prev: nan(ma5[n - 2]) },
    ma10: { cur: nan(ma10[n - 1]), prev: nan(ma10[n - 2]) },
    ma20: { cur: nan(ma20[n - 1]), prev: nan(ma20[n - 2]) },
    ma60: { cur: nan(ma60[n - 1]), prev: nan(ma60[n - 2]) },
    ema12: { cur: nan(e12[n - 1]), prev: nan(e12[n - 2]) },
    ema26: { cur: nan(e26[n - 1]), prev: nan(e26[n - 2]) },
    rsi14: { cur: nan(r[n - 1]), prev: nan(r[n - 2]) },
    macd_dif: { cur: nan(dif[n - 1]), prev: nan(dif[n - 2]) },
    macd_dea: { cur: nan(dea[n - 1]), prev: nan(dea[n - 2]) },
    macd_hist: { cur: nan(hist[n - 1]), prev: nan(hist[n - 2]) },
    boll_upper: { cur: nan(bb.upper[n - 1]), prev: nan(bb.upper[n - 2]) },
    boll_lower: { cur: nan(bb.lower[n - 1]), prev: nan(bb.lower[n - 2]) },
    high20: { cur: hi20, prev: null },
    low20: { cur: lo20, prev: null },
    vol_ma5: { cur: nan(volMa[n - 1]), prev: nan(volMa[n - 2]) },
  };

  return {
    close: c[n - 1],
    get: (k) => table[k].cur,
    prev: (k) => table[k].prev,
  };
}

/* ------------------------------ 条件 ------------------------------ */

export type CompareOp = '>' | '<' | '>=' | '<=';

export type Condition =
  /** 指标与数值比较 */
  | { kind: 'compare'; indicator: IndicatorKey; op: CompareOp; value: number }
  /** 指标与另一指标比较 */
  | { kind: 'compare_ind'; left: IndicatorKey; op: CompareOp; right: IndicatorKey }
  /** 交叉：left 上穿 right（金叉语义） */
  | { kind: 'cross_above'; left: IndicatorKey; right: IndicatorKey }
  /** 交叉：left 下穿 right */
  | { kind: 'cross_below'; left: IndicatorKey; right: IndicatorKey }
  /** 量比：volume / vol_ma5 */
  | { kind: 'vol_ratio'; op: CompareOp; value: number };

function resolve(snap: IndicatorSnapshot, ind: IndicatorKey, which: 'cur' | 'prev'): number | null {
  return which === 'cur' ? snap.get(ind) : snap.prev(ind);
}

export function evalCondition(c: Condition, snap: IndicatorSnapshot): boolean {
  switch (c.kind) {
    case 'compare': {
      const v = snap.get(c.indicator);
      if (v == null) return false;
      return cmp(v, c.op, c.value);
    }
    case 'compare_ind': {
      const l = snap.get(c.left);
      const r = snap.get(c.right);
      if (l == null || r == null) return false;
      return cmp(l, c.op, r);
    }
    case 'cross_above': {
      const lc = snap.get(c.left), rc = snap.get(c.right);
      const lp = snap.prev(c.left), rp = snap.prev(c.right);
      if (lc == null || rc == null || lp == null || rp == null) return false;
      return lp <= rp && lc > rc;
    }
    case 'cross_below': {
      const lc = snap.get(c.left), rc = snap.get(c.right);
      const lp = snap.prev(c.left), rp = snap.prev(c.right);
      if (lc == null || rc == null || lp == null || rp == null) return false;
      return lp >= rp && lc < rc;
    }
    case 'vol_ratio': {
      const vol = snap.get('volume');
      const ma = snap.get('vol_ma5');
      if (vol == null || ma == null || ma <= 0) return false;
      return cmp(vol / ma, c.op, c.value);
    }
  }
}

function cmp(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
  }
}

/* ------------------------------ 规则 ------------------------------ */

export interface CompositeRule {
  mode: 'and' | 'or';
  conditions: Condition[];
  side: Exclude<SignalSide, 'hold'>;
  /** 默认 2 */
  strength?: number;
  /** 缺省时自动生成 */
  reason?: string;
}

export interface CompositeStrategyDef {
  id: string;
  label: string;
  /** 任一规则命中即产出信号（多规则之间为 OR） */
  rules: CompositeRule[];
}

function ruleHit(rule: CompositeRule, snap: IndicatorSnapshot): boolean {
  if (rule.conditions.length === 0) return false;
  if (rule.mode === 'and') return rule.conditions.every((c) => evalCondition(c, snap));
  return rule.conditions.some((c) => evalCondition(c, snap));
}

function autoReason(rule: CompositeRule): string {
  const parts = rule.conditions.map((c) => {
    switch (c.kind) {
      case 'compare': return `${c.indicator}${c.op}${c.value}`;
      case 'compare_ind': return `${c.left}${c.op}${c.right}`;
      case 'cross_above': return `${c.left}上穿${c.right}`;
      case 'cross_below': return `${c.left}下穿${c.right}`;
      case 'vol_ratio': return `量比${c.op}${c.value}`;
    }
  });
  return `${rule.mode === 'and' ? '同时满足' : '满足任一'}：${parts.join('、')}`;
}

/** 评估组合策略：命中第一条规则即返回信号。
 *  强度按 side 归一：sell 强制为负、buy 强制为正，避免自定义规则符号写反导致信号翻转。
 */
export function evaluateComposite(
  def: CompositeStrategyDef,
  candles: Candle[],
): PartialSignal | null {
  const snap = buildSnapshot(candles);
  if (!snap) return null;
  for (const rule of def.rules) {
    if (ruleHit(rule, snap)) {
      const mag = Math.abs(rule.strength ?? 2);
      const strength = rule.side === 'sell' ? -mag : mag;
      return {
        side: rule.side,
        reason: rule.reason ?? autoReason(rule),
        strength,
      };
    }
  }
  return null;
}

/* ------------------------------ 预置组合模板 ------------------------------ */

/**
 * 唯一内置策略：趋势确认（Trend Confirm）。
 *
 * 买入（AND 全部满足）：
 *  1. MA5 上穿 MA20 —— 短期动量转多
 *  2. RSI14 < 60    —— 尚未超买，追高风险低
 *  3. 量比 ≥ 1.2    —— 有资金配合，假突破概率低
 *  4. 收盘 > MA60   —— 长期趋势向上，顺势
 *
 * 卖出（OR 任一满足）：
 *  1. MA5 下穿 MA20 —— 动量转空
 *  2. RSI14 > 70    —— 超买，止盈/避回撤
 *
 * 设计取舍：四条件同时过滤「假金叉 / 超买追高 / 无量拉升 / 逆势」，
 * 命中率低于单指标，但单次信号质量更高。
 */
export const TREND_CONFIRM: CompositeStrategyDef = {
  id: 'trend_confirm',
  label: '趋势确认',
  rules: [
    {
      mode: 'and',
      side: 'buy',
      strength: 2,
      reason: '趋势确认买入：MA金叉+RSI<60+放量+站上MA60',
      conditions: [
        { kind: 'cross_above', left: 'ma5', right: 'ma20' },
        { kind: 'compare', indicator: 'rsi14', op: '<', value: 60 },
        { kind: 'vol_ratio', op: '>=', value: 1.2 },
        { kind: 'compare_ind', left: 'close', op: '>', right: 'ma60' },
      ],
    },
    {
      mode: 'or',
      side: 'sell',
      strength: -2,
      reason: '趋势确认卖出：MA死叉或RSI超买',
      conditions: [
        { kind: 'cross_below', left: 'ma5', right: 'ma20' },
        { kind: 'compare', indicator: 'rsi14', op: '>', value: 70 },
      ],
    },
  ],
};

/** 预置组合模板：仅内置趋势确认（其余可由用户自定义 CompositeStrategyDef） */
export const COMPOSITE_PRESETS: CompositeStrategyDef[] = [TREND_CONFIRM];
