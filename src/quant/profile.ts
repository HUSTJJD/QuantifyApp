/**
 * 量化策略档案（Strategy Profile）数据模型。
 *
 * 从「信号」升级为「可编辑策略」：一个策略档案 = 一个可独立运行的交易系统，
 * 包含：选股标准（范围/过滤）、买卖信号（指标参数）、止盈止损/移动止损、
 * 交易规则（时段 / K线周期 / 仓位 / 最大持仓数）。
 *
 * 说明：买卖信号复用 src/quant/strategies.ts 注册表里的指标引擎作为「信号内核」，
 * 策略档案是对它的可编辑配置层；后续可按需求迭代新增选股模型/风控等能力。
 */
import type { Candle, Quote } from '@/api';
import { STRATEGIES, type Strategy, type PartialSignal } from './strategies';
import { chinaParts } from '@/utils/trading';

/* ---------------------------------- 枚举 ---------------------------------- */

/** 选股范围（v0：自选股池，后续可扩展全市场扫描） */
export type Universe = 'watchlist';
/** 可交易的 K 线周期（SignalEngine 支持的子集） */
export type SignalPeriod = 'day' | '60m' | '30m' | '15m' | '5m' | '1m';
/** 交易时段（早盘/盘中/尾盘/全天） */
export type TradeSession = 'early' | 'intraday' | 'late' | 'any';

export const UNIVERSE_LABEL: Record<Universe, string> = { watchlist: '自选股' };
export const PERIOD_LABELS: Record<SignalPeriod, string> = {
  day: '日K', '60m': '60分', '30m': '30分', '15m': '15分', '5m': '5分', '1m': '1分',
};
export const SESSION_LABELS: Record<TradeSession, string> = {
  any: '全天', early: '早盘(9:30-10:30)', intraday: '盘中', late: '尾盘(14:30-15:00)',
};
/** 早盘/盘中/尾盘的分钟边界（盘中覆盖两段） */
const SESSION_RANGES: Record<Exclude<TradeSession, 'any'>, [number, number][]> = {
  early: [[9 * 60 + 30, 10 * 60 + 30]],
  intraday: [
    [10 * 60 + 30, 11 * 60 + 30],
    [13 * 60, 14 * 60 + 30],
  ],
  late: [[14 * 60 + 30, 15 * 60]],
};

/* ---------------------------------- 规则 ---------------------------------- */

/** 选股标准：范围 + 简单过滤条件（value<=0 表示不限制） */
export interface SelectionRules {
  universe: Universe;
  /** 股价上限（元），0 = 不限 */
  priceMax: number;
  /** 最小成交额（万元），0 = 不限 */
  minTurnoverWan: number;
}

/** 止盈止损（0 = 关闭；百分比为正数）。trailingPct>0 即开启移动止损 */
export interface ExitRules {
  /** 止盈：相对成本价上涨达到该百分比平仓 */
  takeProfitPct: number;
  /** 止损：相对成本价下跌达到该百分比平仓 */
  stopLossPct: number;
  /** 移动止损距离（百分比），>0 开启 */
  trailingPct: number;
}

/** 交易规则 */
export interface TradeRules {
  /** 允许下单时段（any=全交易时段） */
  session: TradeSession;
  /** 信号计算使用的 K 线周期 */
  period: SignalPeriod;
  /** 单笔仓位比例 0~1 */
  positionRatio: number;
  /** 同时最大持仓数 */
  maxPositions: number;
}

/** 策略档案（用户可编辑单元） */
export interface StrategyProfile {
  /** 唯一 id（= templateId，同模板只允许一个档案，保证信号配置可映射） */
  id: string;
  /** 对应 strategies.ts 里信号内核策略的 id */
  templateId: string;
  /** 用户自定义名称（默认取模板 label） */
  name: string;
  /** 描述（模板 label + 一句话） */
  note: string;
  enabled: boolean;
  /** 开启专属模拟盘：行情时段内出现信号自动触发交易 */
  autoTrade: boolean;
  /** 买卖信号指标参数（覆盖模板 defaultParams） */
  params: Record<string, number>;
  selection: SelectionRules;
  exit: ExitRules;
  trade: TradeRules;
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------- 工厂/辅助 ------------------------------- */

export function templateById(templateId: string): Strategy | undefined {
  return STRATEGIES.find((s) => s.id === templateId);
}

/** 默认选股/止盈/交易规则（新建档案用） */
export function defaultSelection(): SelectionRules {
  return { universe: 'watchlist', priceMax: 0, minTurnoverWan: 0 };
}
export function defaultExit(): ExitRules {
  return { takeProfitPct: 10, stopLossPct: 5, trailingPct: 0 };
}
export function defaultTradeRules(): TradeRules {
  return { session: 'any', period: 'day', positionRatio: 1 / 3, maxPositions: 1 };
}

/** 从模板创建默认档案（id = templateId） */
export function createProfileFromTemplate(templateId: string, now = Date.now()): StrategyProfile {
  const t = templateById(templateId);
  if (!t) throw new Error(`未知策略模板: ${templateId}`);
  return {
    id: templateId,
    templateId,
    name: t.label,
    note: t.label,
    enabled: t.enabledByDefault,
    autoTrade: false,
    params: { ...(t.defaultParams ?? {}) },
    selection: defaultSelection(),
    exit: defaultExit(),
    trade: defaultTradeRules(),
    createdAt: now,
    updatedAt: now,
  };
}

/** 把档案换算成引擎可执行的 Strategy（回测 / 全局信号聚合用）。 */
export function strategyOfProfile(p: StrategyProfile): Strategy {
  const t = templateById(p.templateId)!;
  return {
    id: p.id,
    label: p.name,
    enabledByDefault: true,
    defaultParams: { ...t.defaultParams },
    evaluate: (candles: Candle[], ctx: { quote?: Quote | null; params?: Record<string, number> }) =>
      t.evaluate(candles, { ...ctx, params: { ...t.defaultParams, ...p.params, ...ctx.params } }),
  };
}

/** 直接按档案参数评估信号内核（供自动交易运行时用，避免额外包装）。 */
export function evaluateProfile(p: StrategyProfile, candles: Candle[], quote?: Quote | null): PartialSignal | null {
  const t = templateById(p.templateId);
  if (!t || candles.length === 0) return null;
  return t.evaluate(candles, { quote, params: { ...t.defaultParams, ...p.params } });
}

/** 参数编辑器元数据（由 defaultParams key → 中文标签 + 步进范围）。 */
export const PARAM_SPECS: Record<string, { key: string; label: string; min?: number; max?: number; step?: number }[]> = {
  // 趋势确认当前无运行时参数（条件阈值写死在 composite.ts 规则里）
  trend_confirm: [],
};

export function paramSpecsOf(templateId: string): { key: string; label: string; min?: number; max?: number; step?: number }[] {
  return PARAM_SPECS[templateId] ?? [];
}

/* --------------------------------- 规则判断 -------------------------------- */

/** 当前分钟是否落在某交易时段（any=只要是交易时段）。非交易时间一律 false。 */
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

/** 检查固定止盈止损（基于成本价与最新价）。 */
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

/** 检查移动止损（基于开仓后的最高价）。 */
export function checkTrailingStop(peak: number, last: number, pct: number): boolean {
  if (pct <= 0 || peak <= 0 || last <= 0) return false;
  return last <= peak * (1 - pct / 100);
}

/** 简单选股过滤（基于最新行情）。 */
export function passesSelection(sel: SelectionRules, q: Quote | null): boolean {
  if (!q || q.last <= 0) return false;
  if (sel.priceMax > 0 && q.last > sel.priceMax) return false;
  if (sel.minTurnoverWan > 0 && q.amount / 1e4 < sel.minTurnoverWan) return false;
  return true;
}
