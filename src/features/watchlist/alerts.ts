/**
 * 自选股异动检测引擎（M4 核心，纯函数）。
 * 输入标的实时行情（与可选历史 K 线），按规则集产出异动事件。
 * 与 UI / 存储解耦，便于单测与后续接入轮询推送。
 */
import type { Symbol, Quote, Candle } from '@/api';

export type AlertType = 'pct' | 'volumeSpike' | 'breakout';

export interface AlertRule {
  id: string;
  type: AlertType;
  /** pct: 涨跌幅阈值(%)；volumeSpike: 成交量阈值(手)；breakout: 突破周期(根) */
  threshold: number;
  enabled?: boolean;
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
    default:
      return null;
  }
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

/** 默认异动规则集（涨跌幅 ±5% / 成交量 ≥ 50万手 / 突破 20 根新高）。 */
export const DEFAULT_ALERT_RULES: AlertRule[] = [
  { id: 'pct-5', type: 'pct', threshold: 5 },
  { id: 'vol-50w', type: 'volumeSpike', threshold: 500000 },
  { id: 'breakout-20', type: 'breakout', threshold: 20 },
];
