/**
 * 决策卡纯逻辑：评分分档 + 策略倾向摘要 + 论点/风险抽取。
 */
import type { TradeSignal } from '@/quant/signals';

export type ScoreGrade = 'A' | 'B+' | 'B' | 'C' | 'D';

export function scoreGrade(score: number): ScoreGrade {
  if (!Number.isFinite(score)) return 'C';
  if (score >= 2.2) return 'A';
  if (score >= 1.2) return 'B+';
  if (score >= 0.3) return 'B';
  if (score >= -0.8) return 'C';
  return 'D';
}

export interface StrategyBias {
  label: '偏多' | '中性' | '偏空';
  buyCount: number;
  sellCount: number;
  holdCount: number;
}

export function summarizeStrategy(signals: TradeSignal[]): StrategyBias {
  let buy = 0;
  let sell = 0;
  let hold = 0;
  for (const s of signals) {
    if (s.side === 'buy') buy += 1;
    else if (s.side === 'sell') sell += 1;
    else hold += 1;
  }
  const label = buy > sell ? '偏多' : sell > buy ? '偏空' : '中性';
  return { label, buyCount: buy, sellCount: sell, holdCount: hold };
}

export function compositeFromSignals(signals: TradeSignal[]): number {
  if (!signals.length) return 0;
  let sum = 0;
  for (const s of signals) {
    const strength = typeof s.strength === 'number' ? s.strength : 0;
    sum += s.side === 'buy' ? Math.abs(strength) : s.side === 'sell' ? -Math.abs(strength) : 0;
  }
  return sum;
}

/** 从信号解释抽最多 n 条论点 */
export function pickThesis(signals: TradeSignal[], n = 3): string[] {
  const out: string[] = [];
  for (const s of signals) {
    if (s.side === 'hold') continue;
    if (s.reasons?.length) {
      for (const r of s.reasons.slice(0, 2)) out.push(r);
    } else {
      out.push(s.side === 'buy' ? '买入信号' : '卖出信号');
    }
    if (out.length >= n) break;
  }
  return out.slice(0, n);
}

export function pickRisks(signals: TradeSignal[], grade: ScoreGrade, n = 2): string[] {
  const risks: string[] = [];
  const sells = signals.filter((s) => s.side === 'sell');
  for (const s of sells.slice(0, n)) {
    risks.push(s.reasons?.[0] || '存在卖出信号');
  }
  if (grade === 'D' || grade === 'C') {
    if (risks.length < n) risks.push('综合评分偏弱，注意回撤与止损');
  }
  if (risks.length < n && signals.length === 0) {
    risks.push('信号样本不足');
  }
  return risks.slice(0, n);
}

export const DECISION_LEGEND =
  '评分基于价值/质量/成长/动量等因子与策略信号，仅供参考，不构成投资建议。';

export interface DecisionSummary {
  score: number;
  grade: ScoreGrade;
  bias: StrategyBias;
  thesis: string[];
  risks: string[];
}

export function buildDecisionSummary(signals: TradeSignal[]): DecisionSummary {
  const score = compositeFromSignals(signals);
  const grade = scoreGrade(score);
  const bias = summarizeStrategy(signals);
  return {
    score,
    grade,
    bias,
    thesis: pickThesis(signals),
    risks: pickRisks(signals, grade),
  };
}
