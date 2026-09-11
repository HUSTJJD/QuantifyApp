/**
 * 自选股异动检测引擎（M4 核心，纯函数）。
 * 输入标的实时行情（与可选历史 K 线），按规则集产出异动事件。
 * 与 UI / 存储解耦，便于单测与后续接入轮询推送。
 */
import type { Symbol, Quote, Candle } from '@/data/api';
import { sma, rsi, closes } from '@/quant/indicators';

export type AlertType =
  | 'pct'
  | 'volumeSpike'
  | 'breakout'
  | 'priceAbove'
  | 'priceBelow'
  | 'maCross'
  | 'rsiZone';

/** 指标类规则的可选参数 */
export interface AlertRuleParams {
  /** maCross 快线周期 */
  fast?: number;
  /** maCross 慢线周期 */
  slow?: number;
  /** rsiZone 周期 */
  period?: number;
  /** rsiZone 超卖阈值 */
  buy?: number;
  /** rsiZone 超买阈值 */
  sell?: number;
}

export interface AlertRule {
  id: string;
  type: AlertType;
  /** pct: 涨跌幅阈值(%)；volumeSpike: 成交量阈值(手)；breakout: 突破周期(根)；priceAbove/priceBelow: 价格阈值(元)；
   *  maCross: 0（用 params）；rsiZone: 超买阈值（可被 params.sell 覆盖） */
  threshold: number;
  params?: AlertRuleParams;
  enabled?: boolean;
  /** 仅对指定标的生效（priceAbove/priceBelow 必填；其他类型为空表示全自选） */
  symbolKey?: string;
}

export interface AlertEvent {
  ruleId: string;
  type: AlertType;
  symbol: Symbol;
  /** 触发数值（pct 为 %、volumeSpike 为手、breakout 为周期） */
  value: number;
  message: string;
  time: number;
}

export interface AlertInput {
  symbol: Symbol;
  quote: Quote;
  /** 可选历史 K 线（breakout 突破用） */
  candles?: Candle[];
}

function pctOf(q: Quote): number {
  if (!q.prevClose) return 0;
  return ((q.last - q.prevClose) / q.prevClose) * 100;
}

/** 执行单条规则，返回事件或 null。 */
function runRule(rule: AlertRule, input: AlertInput, now: number): AlertEvent | null {
  if (rule.enabled === false) return null;
  const { symbol, quote, candles } = input;
  switch (rule.type) {
    case 'pct': {
      const p = pctOf(quote);
      if (Math.abs(p) >= rule.threshold) {
        const dir = p >= 0 ? '上涨' : '下跌';
        return {
          ruleId: rule.id,
          type: 'pct',
          symbol,
          value: p,
          message: `${dir} ${Math.abs(p).toFixed(2)}%（阈值 ${rule.threshold}%）`,
          time: now,
        };
      }
      return null;
    }
    case 'volumeSpike': {
      const v = quote.volume ?? 0;
      if (v >= rule.threshold) {
        return {
          ruleId: rule.id,
          type: 'volumeSpike',
          symbol,
          value: v,
          message: `成交量放大至 ${v.toLocaleString('zh-CN')} 手（阈值 ${rule.threshold}）`,
          time: now,
        };
      }
      return null;
    }
    case 'breakout': {
      if (!candles || candles.length < rule.threshold + 1) return null;
      const n = rule.threshold;
      const recent = candles.slice(-n);
      const prevHigh = Math.max(...candles.slice(0, -n).map((c) => c.high));
      const curHigh = Math.max(...recent.map((c) => c.high));
      if (curHigh > prevHigh) {
        return {
          ruleId: rule.id,
          type: 'breakout',
          symbol,
          value: n,
          message: `突破近 ${n} 根 K 线高点（${curHigh.toFixed(2)} > ${prevHigh.toFixed(2)}）`,
          time: now,
        };
      }
      return null;
    }
    case 'priceAbove': {
      if (rule.symbolKey && rule.symbolKey !== `${symbol.code}.${symbol.exchange}`) return null;
      if (quote.last >= rule.threshold) {
        return {
          ruleId: rule.id,
          type: 'priceAbove',
          symbol,
          value: quote.last,
          message: `现价 ${quote.last.toFixed(2)} 突破 ${rule.threshold.toFixed(2)}`,
          time: now,
        };
      }
      return null;
    }
    case 'priceBelow': {
      if (rule.symbolKey && rule.symbolKey !== `${symbol.code}.${symbol.exchange}`) return null;
      if (quote.last > 0 && quote.last <= rule.threshold) {
        return {
          ruleId: rule.id,
          type: 'priceBelow',
          symbol,
          value: quote.last,
          message: `现价 ${quote.last.toFixed(2)} 跌破 ${rule.threshold.toFixed(2)}`,
          time: now,
        };
      }
      return null;
    }
    case 'maCross': {
      if (!candles || candles.length < 5) return null;
      const fastP = Math.max(2, Math.round(rule.params?.fast ?? 5));
      const slowP = Math.max(fastP + 1, Math.round(rule.params?.slow ?? 20));
      if (candles.length < slowP + 2) return null;
      const c = closes(candles);
      const fast = sma(c, fastP);
      const slow = sma(c, slowP);
      const i = c.length - 1;
      const f = fast[i], s = slow[i], fp = fast[i - 1], sp = slow[i - 1];
      if ([f, s, fp, sp].some((v) => v == null || Number.isNaN(v))) return null;
      if (fp <= sp && f > s) {
        return {
          ruleId: rule.id,
          type: 'maCross',
          symbol,
          value: 1,
          message: `MA${fastP} 上穿 MA${slowP}（金叉）`,
          time: now,
        };
      }
      if (fp >= sp && f < s) {
        return {
          ruleId: rule.id,
          type: 'maCross',
          symbol,
          value: -1,
          message: `MA${fastP} 下穿 MA${slowP}（死叉）`,
          time: now,
        };
      }
      return null;
    }
    case 'rsiZone': {
      if (!candles || candles.length < 5) return null;
      const period = Math.max(2, Math.round(rule.params?.period ?? 14));
      const buy = rule.params?.buy ?? 30;
      const sell = rule.params?.sell ?? rule.threshold ?? 70;
      if (candles.length < period + 2) return null;
      const arr = rsi(closes(candles), period);
      const v = arr[arr.length - 1];
      const prev = arr[arr.length - 2];
      if (v == null || Number.isNaN(v) || prev == null || Number.isNaN(prev)) return null;
      // 只在「刚进入」超买/超卖区时告警，避免盘中反复轰炸（dedupe 也按天挡一层）
      if (v > sell && prev <= sell) {
        return {
          ruleId: rule.id,
          type: 'rsiZone',
          symbol,
          value: v,
          message: `RSI 进入超买（${v.toFixed(0)} > ${sell}）`,
          time: now,
        };
      }
      if (v < buy && prev >= buy) {
        return {
          ruleId: rule.id,
          type: 'rsiZone',
          symbol,
          value: v,
          message: `RSI 进入超卖（${v.toFixed(0)} < ${buy}）`,
          time: now,
        };
      }
      return null;
    }
    default:
      return null;
  }
}

/** 该规则是否需要 K 线输入 */
export function ruleNeedsCandles(rule: AlertRule): boolean {
  return rule.type === 'breakout' || rule.type === 'maCross' || rule.type === 'rsiZone';
}

/** 对一批标的同时跑全部规则，返回所有触发的异动事件。 */
export function detectAlerts(inputs: AlertInput[], rules: AlertRule[]): AlertEvent[] {
  const now = Date.now();
  const events: AlertEvent[] = [];
  for (const input of inputs) {
    for (const rule of rules) {
      const e = runRule(rule, input, now);
      if (e) events.push(e);
    }
  }
  return events;
}

/** 默认异动规则集（涨跌幅 ±5% / 成交量 ≥ 50万手 / 突破 20 根新高）。指标类默认关闭，可在告警规则页开启。 */
export const DEFAULT_ALERT_RULES: AlertRule[] = [
  { id: 'pct-5', type: 'pct', threshold: 5 },
  { id: 'vol-50w', type: 'volumeSpike', threshold: 500000 },
  { id: 'breakout-20', type: 'breakout', threshold: 20 },
  { id: 'ma-cross-5-20', type: 'maCross', threshold: 0, params: { fast: 5, slow: 20 }, enabled: false },
  { id: 'rsi-zone', type: 'rsiZone', threshold: 70, params: { period: 14, buy: 30, sell: 70 }, enabled: false },
];

/** 规则类型中文名（UI 用） */
export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  pct: '涨跌幅',
  volumeSpike: '成交量放大',
  breakout: 'N日突破',
  priceAbove: '价格上破',
  priceBelow: '价格下破',
  maCross: '均线交叉',
  rsiZone: 'RSI 超买超卖',
};
