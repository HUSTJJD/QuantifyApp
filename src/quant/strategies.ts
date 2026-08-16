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
}

export interface Strategy {
  id: string;
  label: string;
  /** 默认是否启用 */
  enabledByDefault: boolean;
  evaluate: (candles: Candle[], ctx: StrategyContext) => PartialSignal | null;
}

/** MA 金叉/死叉（快线×慢线）。 */
const maCross: Strategy = {
  id: 'ma_cross',
  label: 'MA 金叉/死叉',
  enabledByDefault: true,
  evaluate: (candles) => {
    if (candles.length < 22) return null;
    const close = closes(candles);
    const fast = sma(close, 5);
    const slow = sma(close, 20);
    const i = close.length - 1;
    const pf = fast[i];
    const ps = slow[i];
    const pfPrev = fast[i - 1];
    const psPrev = slow[i - 1];
    if (Number.isNaN(pf) || Number.isNaN(ps) || Number.isNaN(pfPrev) || Number.isNaN(psPrev)) return null;
    if (pfPrev <= psPrev && pf > ps) {
      return { side: 'buy', reason: 'MA5 上穿 MA20（金叉）', strength: 2 };
    }
    if (pfPrev >= psPrev && pf < ps) {
      return { side: 'sell', reason: 'MA5 下穿 MA20（死叉）', strength: -2 };
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

/** 全部已注册策略（顺序即合并优先级）。增删即扩展你的专属量化。 */
export const STRATEGIES: Strategy[] = [maCross, macdCross, rsiSignal, breakout];

export interface StrategyConfig {
  enabled: Record<string, boolean>;
}

/** 取当前启用的策略（合并默认与用户配置）。 */
export function activeStrategies(cfg: StrategyConfig): Strategy[] {
  return STRATEGIES.filter((s) => cfg.enabled[s.id] ?? s.enabledByDefault);
}

// 避免顶部重复 import 顺序问题，函数内用到指标
import { sma, macd, rsi, closes } from './indicators';
