/**
 * 量化策略注册表。
 *
 * 这是「个人专属量化模块」的扩展点：每一格策略都是纯函数
 * (candles, latestQuote) => PartialSignal，框架会把它们合并成最终信号。
 * 你后续可在本文件自由增删策略、或在设置页里开关/调参。
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

/** MA 金叉/死叉（快线×慢线），周期可配置。 */
const maCross: Strategy = {
  id: 'ma_cross',
  label: 'MA 金叉/死叉',
  enabledByDefault: true,
  defaultParams: { fast: 5, slow: 20 },
  evaluate: (candles, ctx) => {
    const fastP = ctx.params?.fast ?? 5;
    const slowP = ctx.params?.slow ?? 20;
    if (candles.length < slowP + 2) return null;
    const close = closes(candles);
    const fast = sma(close, fastP);
    const slow = sma(close, slowP);
    const i = close.length - 1;
    const pf = fast[i];
    const ps = slow[i];
    const pfPrev = fast[i - 1];
    const psPrev = slow[i - 1];
    if (Number.isNaN(pf) || Number.isNaN(ps) || Number.isNaN(pfPrev) || Number.isNaN(psPrev)) return null;
    if (pfPrev <= psPrev && pf > ps) {
      return { side: 'buy', reason: `MA${fastP} 上穿 MA${slowP}（金叉）`, strength: 2 };
    }
    if (pfPrev >= psPrev && pf < ps) {
      return { side: 'sell', reason: `MA${fastP} 下穿 MA${slowP}（死叉）`, strength: -2 };
    }
    return null;
  },
};

/** MACD 金叉/死叉。 */
const macdCross: Strategy = {
  id: 'macd_cross',
  label: 'MACD 金叉/死叉',
  enabledByDefault: true,
  evaluate: (candles) => {
    if (candles.length < 35) return null;
    const { dif, dea } = macd(closes(candles));
    const i = dif.length - 1;
    if (Number.isNaN(dif[i]) || Number.isNaN(dea[i])) return null;
    if (dif[i - 1] <= dea[i - 1] && dif[i] > dea[i]) {
      return { side: 'buy', reason: 'MACD 金叉', strength: 2 };
    }
    if (dif[i - 1] >= dea[i - 1] && dif[i] < dea[i]) {
      return { side: 'sell', reason: 'MACD 死叉', strength: -2 };
    }
    return null;
  },
};

/** RSI 超买/超卖。 */
const rsiSignal: Strategy = {
  id: 'rsi',
  label: 'RSI 超买/超卖',
  enabledByDefault: true,
  evaluate: (candles) => {
    if (candles.length < 16) return null;
    const r = rsi(closes(candles), 14);
    const v = r[r.length - 1];
    if (Number.isNaN(v)) return null;
    if (v > 70) return { side: 'sell', reason: `RSI 超买(${v.toFixed(0)})`, strength: -1 };
    if (v < 30) return { side: 'buy', reason: `RSI 超卖(${v.toFixed(0)})`, strength: 1 };
    return null;
  },
};

/** 价格突破 N 日新高。 */
const breakout: Strategy = {
  id: 'breakout',
  label: 'N 日新高突破',
  enabledByDefault: true,
  evaluate: (candles) => {
    const n = 20;
    if (candles.length < n + 1) return null;
    const close = closes(candles);
    const last = close[close.length - 1];
    const window = close.slice(-n - 1, -1);
    const maxPrev = Math.max(...window);
    if (last > maxPrev) {
      return { side: 'buy', reason: `突破${n}日新高`, strength: 1 };
    }
    return null;
  },
};

/** 布林带突破：收盘价向上突破上轨（看多）/ 向下跌破下轨（看空）。 */
const bollingerBreakout: Strategy = {
  id: 'bollinger_breakout',
  label: '布林带突破',
  enabledByDefault: false,
  defaultParams: { period: 20, k: 2 },
  evaluate: (candles, ctx) => {
    const period = ctx.params?.period ?? 20;
    const k = ctx.params?.k ?? 2;
    if (candles.length < period + 2) return null;
    const close = closes(candles);
    const { upper, lower } = bollinger(close, period, k);
    const i = close.length - 1;
    const u = upper[i];
    const l = lower[i];
    const uPrev = upper[i - 1];
    const lPrev = lower[i - 1];
    const last = close[i];
    const prev = close[i - 1];
    if (Number.isNaN(u) || Number.isNaN(l) || Number.isNaN(uPrev) || Number.isNaN(lPrev)) return null;
    if (prev <= uPrev && last > u) {
      return { side: 'buy', reason: `突破布林上轨(${u.toFixed(2)})`, strength: 2 };
    }
    if (prev >= lPrev && last < l) {
      return { side: 'sell', reason: `跌破布林下轨(${l.toFixed(2)})`, strength: -2 };
    }
    return null;
  },
};

/** 量价背离：价格新高但成交量萎缩（顶背离看空）/ 价格新低但放量（底背离看多）。 */
const volumePriceDivergence: Strategy = {
  id: 'volume_price_divergence',
  label: '量价背离',
  enabledByDefault: false,
  defaultParams: { window: 20 },
  evaluate: (candles, ctx) => {
    const w = ctx.params?.window ?? 20;
    if (candles.length < w + 1) return null;
    const close = closes(candles);
    const vol = volumes(candles);
    const i = close.length - 1;
    const lastClose = close[i];
    const lastVol = vol[i];
    const windowClose = close.slice(-w - 1, -1);
    const windowVol = vol.slice(-w - 1, -1);
    const maxClose = Math.max(...windowClose);
    const minClose = Math.min(...windowClose);
    const avgVol = windowVol.reduce((a, b) => a + b, 0) / windowVol.length;

    // 价格创窗口新高，但成交量低于窗口均值 → 上涨动能不足（顶背离，偏空）
    if (lastClose > maxClose && lastVol < avgVol * 0.8) {
      return { side: 'sell', reason: '价升量缩（顶背离）', strength: -1 };
    }
    // 价格创窗口新低，但成交量高于窗口均值 → 恐慌抛售尾声（底背离，偏多）
    if (lastClose < minClose && lastVol > avgVol * 1.2) {
      return { side: 'buy', reason: '价跌量增（底背离）', strength: 1 };
    }
    return null;
  },
};

/** 全部已注册策略（顺序即合并优先级）。增删即扩展你的专属量化。 */
export const STRATEGIES: Strategy[] = [
  maCross,
  macdCross,
  rsiSignal,
  breakout,
  bollingerBreakout,
  volumePriceDivergence,
  // 组合策略：多指标 AND/OR（见 composite.ts）
  ...compositePresetsAsStrategies(),
];

/** 把组合规则模板包装成 Strategy，供信号引擎 / 回测统一调用 */
function compositePresetsAsStrategies(): Strategy[] {
  // 延迟 require 避免与 composite 模块循环依赖（composite 只依赖 indicators + strategies 类型）
  const { evaluateComposite, COMPOSITE_PRESETS } = require('./composite') as typeof import('./composite');
  return COMPOSITE_PRESETS.map((def) => ({
    id: def.id,
    label: def.label,
    enabledByDefault: false,
    evaluate: (candles: Candle[], _ctx: StrategyContext): PartialSignal | null =>
      evaluateComposite(def, candles),
  }));
}

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

// 避免顶部重复 import 顺序问题，函数内用到指标
import { sma, macd, rsi, closes, bollinger, volumes } from './indicators';
