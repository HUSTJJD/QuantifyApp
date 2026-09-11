/**
 * 策略档案（Strategy Profile）—— 唯一的策略用户模型。
 *
 * 一个档案 = 选股 + legs[]（多条策略模板）+ combineMode + 风控/交易规则。
 * templateId 只属于腿，不属于档案；没有「信号内核」绑定。
 */
import type { Candle, Quote } from '@/data/api';
import type { PartialSignal } from '@/domain';
import { evaluateStrategy } from './core/engine';
import { getTemplate } from './core/templates';
import { getFactor } from './core/factors';
import { factorsUsedBy } from './core/engine';
import { STRATEGY_TEMPLATES } from './core/templates';
import { chinaParts } from '@/utils/trading';

/* ---------------------------------- 枚举 ---------------------------------- */

export type Universe = 'watchlist' | 'scan';
export type SignalPeriod = 'day' | '60m' | '30m' | '15m' | '5m' | '1m';
export type TradeSession = 'early' | 'intraday' | 'late' | 'any';
export type CombineMode = 'and' | 'or' | 'vote';

export const COMBINE_LABEL: Record<CombineMode, string> = {
  and: '全部满足(AND)',
  or: '任一满足(OR)',
  vote: '加权投票',
};

export const UNIVERSE_LABEL: Record<Universe, string> = {
  watchlist: '自选股',
  scan: '最近扫描命中',
};
export const PERIOD_LABELS: Record<SignalPeriod, string> = {
  day: '日K', '60m': '60分', '30m': '30分', '15m': '15分', '5m': '5分', '1m': '1分',
};
export const SESSION_LABELS: Record<TradeSession, string> = {
  any: '全天', early: '早盘(9:30-10:30)', intraday: '盘中', late: '尾盘(14:30-15:00)',
};
const SESSION_RANGES: Record<Exclude<TradeSession, 'any'>, [number, number][]> = {
  early: [[9 * 60 + 30, 10 * 60 + 30]],
  intraday: [
    [10 * 60 + 30, 11 * 60 + 30],
    [13 * 60, 14 * 60 + 30],
  ],
  late: [[14 * 60 + 30, 15 * 60]],
};

/* ---------------------------------- 规则 ---------------------------------- */

export interface SelectionRules {
  universe: Universe;
  priceMax: number;
  minTurnoverWan: number;
}

export interface ExitRules {
  takeProfitPct: number;
  stopLossPct: number;
  trailingPct: number;
}

export interface TradeRules {
  session: TradeSession;
  period: SignalPeriod;
  positionRatio: number;
  maxPositions: number;
}

export interface StrategyLeg {
  /** quant/core/templates 中的 id */
  templateId: string;
  enabled: boolean;
  /** vote 模式权重（>=1）；and/or 忽略 */
  weight: number;
  /** 覆盖该腿因子参数，扁平 key = `factorId.paramKey` */
  params: Record<string, number>;
}

export interface StrategyProfile {
  id: string;
  name: string;
  note: string;
  enabled: boolean;
  autoTrade: boolean;
  legs: StrategyLeg[];
  combineMode: CombineMode;
  selection: SelectionRules;
  exit: ExitRules;
  trade: TradeRules;
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------- 工厂/辅助 ------------------------------- */

export function templateById(templateId: string) {
  return STRATEGY_TEMPLATES.find((s) => s.id === templateId);
}

export function legLabel(leg: StrategyLeg): string {
  return templateById(leg.templateId)?.label ?? leg.templateId;
}

export function profileLegsSummary(p: StrategyProfile): string {
  const names = p.legs.filter((l) => l.enabled).map(legLabel);
  return names.length > 0 ? names.join(' + ') : '（无策略腿）';
}

export function defaultSelection(): SelectionRules {
  return { universe: 'watchlist', priceMax: 0, minTurnoverWan: 0 };
}
export function defaultExit(): ExitRules {
  return { takeProfitPct: 10, stopLossPct: 5, trailingPct: 0 };
}
export function defaultTradeRules(): TradeRules {
  return { session: 'any', period: 'day', positionRatio: 1 / 3, maxPositions: 1 };
}

export function newProfileId(now = Date.now()): string {
  return `sp_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function makeLeg(templateId: string, params: Record<string, number> = {}, weight = 1): StrategyLeg {
  return { templateId, enabled: true, weight, params: { ...params } };
}

export function makeLegFromTemplate(templateId: string): StrategyLeg {
  const t = templateById(templateId);
  if (!t) throw new Error(`未知策略模板: ${templateId}`);
  return makeLeg(templateId);
}

export function createProfile(
  legTemplateIds: string[],
  opts?: { name?: string; combineMode?: CombineMode; now?: number },
): StrategyProfile {
  if (!legTemplateIds.length) throw new Error('策略档案至少需要一条策略腿');
  const legs = legTemplateIds.map(makeLegFromTemplate);
  const now = opts?.now ?? Date.now();
  const name = opts?.name ?? (legs.length === 1 ? legLabel(legs[0]) : legs.map(legLabel).join('+'));
  return {
    id: newProfileId(now),
    name,
    note: name,
    enabled: true,
    autoTrade: false,
    legs,
    combineMode: opts?.combineMode ?? 'and',
    selection: defaultSelection(),
    exit: defaultExit(),
    trade: defaultTradeRules(),
    createdAt: now,
    updatedAt: now,
  };
}

/** 内置模板播种的默认档案列表 */
export function seedProfilesFromTemplates(): StrategyProfile[] {
  return STRATEGY_TEMPLATES.map((t) => createProfile([t.id]));
}

/* ------------------------------- 信号评估 ------------------------------- */

function evalLeg(leg: StrategyLeg, candles: Candle[]): PartialSignal | null {
  if (!leg.enabled) return null;
  const tpl = getTemplate(leg.templateId);
  if (!tpl) return null;
  const sig = evaluateStrategy(tpl, candles, factorOverridesFrom(leg.params));
  if (!sig) return null;
  return { side: sig.side, reason: `[${legLabel(leg)}] ${sig.reason}`, strength: sig.strength };
}

export function combineSignals(
  signals: Array<PartialSignal | null>,
  weights: number[],
  mode: CombineMode,
): PartialSignal | null {
  const hits = signals
    .map((s, i) => ({ s, w: Math.max(1, weights[i] ?? 1) }))
    .filter((x): x is { s: PartialSignal; w: number } => x.s != null);
  if (hits.length === 0) return null;

  const buy = hits.filter((h) => h.s.side === 'buy');
  const sell = hits.filter((h) => h.s.side === 'sell');
  const totalW = hits.reduce((a, h) => a + h.w, 0) || 1;

  const pick = (side: 'buy' | 'sell', pool: typeof hits): PartialSignal | null => {
    if (pool.length === 0) return null;
    if (mode === 'and') {
      if (pool.length !== hits.length) return null;
      const strength = Math.min(...pool.map((h) => h.s.strength));
      const reasons = pool.map((h) => h.s.reason).join('；');
      return { side, strength, reason: `全部满足：${reasons}` };
    }
    if (mode === 'or') {
      const best = pool.reduce((a, b) => (b.s.strength > a.s.strength ? b : a));
      return { side, strength: best.s.strength, reason: best.s.reason };
    }
    const wSum = pool.reduce((a, h) => a + h.w, 0);
    if (wSum / totalW < 0.5) return null;
    const avg = pool.reduce((a, h) => a + h.s.strength * h.w, 0) / wSum;
    const reasons = pool.map((h) => `${h.s.reason}(w=${h.w})`).join('；');
    return { side, strength: Math.max(1, Math.round(avg)), reason: `加权通过：${reasons}` };
  };

  const buySig = pick('buy', buy);
  const sellSig = pick('sell', sell);
  if (buySig && sellSig) return sellSig.strength >= buySig.strength ? sellSig : buySig;
  return buySig ?? sellSig;
}

export function evaluateProfile(p: StrategyProfile, candles: Candle[], _quote?: Quote | null): PartialSignal | null {
  if (candles.length === 0 || p.legs.length === 0) return null;
  const signals = p.legs.map((leg) => evalLeg(leg, candles));
  const weights = p.legs.map((l) => l.weight);
  return combineSignals(signals, weights, p.combineMode);
}

/* -------------------------------- 参数元数据 ------------------------------- */

export interface ParamSpec {
  key: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface ParamGroup {
  factorId: string;
  factorLabel: string;
  specs: ParamSpec[];
}

export function paramGroupsOf(templateId: string): ParamGroup[] {
  const tpl = getTemplate(templateId);
  if (!tpl) return [];
  const groups: ParamGroup[] = [];
  for (const fid of factorsUsedBy(tpl)) {
    const f = getFactor(fid);
    if (!f || f.params.length === 0) continue;
    groups.push({
      factorId: fid,
      factorLabel: f.label,
      specs: f.params.map((p) => ({
        key: `${fid}.${p.key}`,
        label: p.label,
        min: p.min,
        max: p.max,
        step: p.step,
      })),
    });
  }
  return groups;
}

export function allParamGroupsOf(profile: StrategyProfile): ParamGroup[] {
  const byFactor = new Map<string, ParamGroup>();
  for (const leg of profile.legs) {
    for (const g of paramGroupsOf(leg.templateId)) {
      if (!byFactor.has(g.factorId)) byFactor.set(g.factorId, g);
    }
  }
  return [...byFactor.values()];
}

export function paramSpecsOf(templateId: string): ParamSpec[] {
  return paramGroupsOf(templateId).flatMap((g) =>
    g.specs.map((s) => ({ ...s, label: `${g.factorLabel} · ${s.label}` })),
  );
}

export function allParamSpecsOf(profile: StrategyProfile): ParamSpec[] {
  return allParamGroupsOf(profile).flatMap((g) =>
    g.specs.map((s) => ({ ...s, label: `${g.factorLabel} · ${s.label}` })),
  );
}

export function factorOverridesFrom(params: Record<string, number>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    const i = k.indexOf('.');
    if (i <= 0) continue;
    const fid = k.slice(0, i);
    const pk = k.slice(i + 1);
    if (!out[fid]) out[fid] = {};
    out[fid][pk] = v;
  }
  return out;
}

/* --------------------------------- 规则判断 -------------------------------- */

export function inTradeSession(session: TradeSession, d: Date = new Date()): boolean {
  const { day, hour, minute } = chinaParts(d);
  if (day === 0 || day === 6) return false;
  const m = hour * 60 + minute;
  if (m < 9 * 60 + 30 || m > 15 * 60) return false;
  if (m > 11 * 60 + 30 && m < 13 * 60) return false;
  if (session === 'any') return true;
  return SESSION_RANGES[session].some(([a, b]) => m >= a && m <= b);
}

export type ExitHit = { kind: 'stop' | 'profit' | 'trail'; reason: string } | null;

export function checkExitRules(cost: number, last: number, exit: ExitRules): ExitHit {
  if (cost <= 0 || last <= 0) return null;
  if (exit.stopLossPct > 0 && last <= cost * (1 - exit.stopLossPct / 100)) {
    return { kind: 'stop', reason: `止损 ${exit.stopLossPct}%` };
  }
  if (exit.takeProfitPct > 0 && last >= cost * (1 + exit.takeProfitPct / 100)) {
    return { kind: 'profit', reason: `止盈 ${exit.takeProfitPct}%` };
  }
  return null;
}

export function checkTrailingStop(peak: number, last: number, pct: number): boolean {
  if (pct <= 0 || peak <= 0 || last <= 0) return false;
  return last <= peak * (1 - pct / 100);
}

export function passesSelection(sel: SelectionRules, q: Quote | null): boolean {
  if (!q || q.last <= 0) return false;
  if (sel.priceMax > 0 && q.last > sel.priceMax) return false;
  if (sel.minTurnoverWan > 0 && q.amount / 1e4 < sel.minTurnoverWan) return false;
  return true;
}

/* ------------------------------ 回测适配（非桥） ------------------------------ */

/** 回测/扫描只需要 evaluate 函数，不必再造旧 Strategy 类型 */
export type ProfileEvaluator = (candles: Candle[], quote?: Quote | null) => PartialSignal | null;

export function profileEvaluator(p: StrategyProfile): ProfileEvaluator {
  return (candles, quote) => evaluateProfile(p, candles, quote);
}

/** 注入扁平参数覆盖后的档案（参数扫描用） */
export function profileWithParams(p: StrategyProfile, params: Record<string, number>): StrategyProfile {
  return {
    ...p,
    legs: p.legs.map((leg) => ({ ...leg, params: { ...leg.params, ...params } })),
  };
}
