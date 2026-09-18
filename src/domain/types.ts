/**
 * 纯领域类型：信号、告警、扫描套餐。
 * 供 quant / features / simulation 共享，禁止在此 import UI 或存储。
 */
import type { AppSymbol } from './symbol';

/** 应用内统一标的（历史名 Symbol） */
export type Symbol = AppSymbol;

/* ------------------------------- 信号 ------------------------------- */

export type SignalSide = 'buy' | 'sell' | 'hold';

/** 单腿/单模板产出的局部信号 */
export interface PartialSignal {
  side: SignalSide;
  reason: string;
  /** -3（强卖）~ +3（强买） */
  strength: number;
}

/** 单腿贡献明细（TradeSignal.contributions 元素） */
export interface SignalContribution {
  /** 策略腿模板 id */
  templateId: string;
  label: string;
  side: SignalSide;
  strength: number;
  weight: number;
  reason: string;
}

/** 某策略档案对某标的的最终信号 */
export interface TradeSignal {
  symbol: Symbol;
  symbolKey: string;
  side: SignalSide;
  strength: number;
  /** 产出该信号的策略档案 */
  profileId: string;
  profileName: string;
  reasons: string[];
  contributions: SignalContribution[];
  ts: number;
}

/* ------------------------------- 告警 ------------------------------- */

export type AlertType =
  | 'pct'
  | 'volumeSpike'
  | 'breakout'
  | 'priceAbove'
  | 'priceBelow'
  | 'maCross'
  | 'rsiZone';

export interface AlertRuleParams {
  fast?: number;
  slow?: number;
  period?: number;
  buy?: number;
  sell?: number;
}

export interface AlertRule {
  id: string;
  type: AlertType;
  threshold: number;
  params?: AlertRuleParams;
  enabled?: boolean;
  symbolKey?: string;
}

export interface AlertEvent {
  ruleId: string;
  type: AlertType;
  symbol: Symbol;
  value: number;
  message: string;
  time: number;
}

/* --------------------------- 尾盘扫描套餐 --------------------------- */

export type EodPresetId = 'volume_breakout' | 'golden_confirm' | 'pullback_ma';
