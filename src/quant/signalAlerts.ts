/**
 * 信号告警 + 分级提示（纯函数）。
 * TradeSignal（档案驱动）→ AlertEvent；持仓门控 / 连续确认。
 */
import type { AlertEvent, SignalSide, TradeSignal } from '@/domain';

export const SIGNAL_RULE_PREFIX = 'signal_';

export function signalRuleId(profileId: string): string {
  return `${SIGNAL_RULE_PREFIX}${profileId}`;
}

export type HintAction = '买入' | '加仓' | '减仓' | '卖出';

export interface GradedHint {
  action: HintAction;
  actionable: boolean;
  note: string;
}

const STRONG = 2;

export function gradeSignalHint(sig: TradeSignal, heldQty: number): GradedHint {
  if (sig.side === 'buy') {
    if (heldQty > 0) return { action: '加仓', actionable: true, note: '已持仓，建议加仓' };
    return { action: '买入', actionable: true, note: '空仓，建议建仓' };
  }
  if (sig.side === 'sell') {
    if (heldQty > 0) {
      if (Math.abs(sig.strength) >= STRONG) {
        return { action: '卖出', actionable: true, note: '强度强，建议清仓' };
      }
      return { action: '减仓', actionable: true, note: '强度弱，建议减仓' };
    }
    return { action: '卖出', actionable: false, note: '未持仓，不提示卖出' };
  }
  return { action: '买入', actionable: false, note: '中性信号' };
}

export interface HintContext {
  heldQty: number;
  positionPct?: number;
  maxPositionPct?: number;
}

export function isHintActionable(sig: TradeSignal, ctx: HintContext): boolean {
  const graded = gradeSignalHint(sig, ctx.heldQty);
  if (!graded.actionable) return false;
  if (sig.side === 'buy' && ctx.maxPositionPct != null && ctx.positionPct != null) {
    if (ctx.positionPct >= ctx.maxPositionPct) return false;
  }
  return true;
}

export function confirmSignal(recentSides: SignalSide[], sig: TradeSignal, minBars = 2): boolean {
  if (sig.side === 'hold') return false;
  if (recentSides.length < minBars) return false;
  return recentSides.slice(-minBars).every((s) => s === sig.side);
}

export interface SignalAlertOptions {
  heldQtyByKey?: Map<string, number>;
  maxPositionPct?: number;
  recentSidesByKey?: Map<string, SignalSide[]>;
  minConfirmationBars?: number;
}

export function signalToAlertEvent(
  sig: TradeSignal,
  minStrength = 1,
  opts: SignalAlertOptions = {},
): AlertEvent | null {
  if (sig.side === 'hold') return null;
  if (Math.abs(sig.strength) < minStrength) return null;

  const heldQty = opts.heldQtyByKey?.get(sig.symbolKey) ?? 0;
  if (!isHintActionable(sig, { heldQty, maxPositionPct: opts.maxPositionPct })) return null;

  if (opts.minConfirmationBars && opts.minConfirmationBars > 0) {
    const recent = opts.recentSidesByKey?.get(sig.symbolKey);
    if (!confirmSignal(recent ?? [], sig, opts.minConfirmationBars)) return null;
  }

  const graded = gradeSignalHint(sig, heldQty);
  return {
    ruleId: signalRuleId(sig.profileId),
    type: 'pct',
    symbol: sig.symbol,
    value: sig.strength,
    message: `${graded.action}信号（强度 ${sig.strength.toFixed(1)}）· ${sig.profileName} · ${sig.reasons.slice(0, 2).join('、')}`,
    time: sig.ts,
  };
}

export function signalsToAlertEvents(
  signals: TradeSignal[],
  allowedProfileIds?: Set<string>,
  minStrength = 1,
  opts: SignalAlertOptions = {},
): AlertEvent[] {
  const out: AlertEvent[] = [];
  for (const sig of signals) {
    if (allowedProfileIds && !allowedProfileIds.has(sig.profileId)) continue;
    const e = signalToAlertEvent(sig, minStrength, opts);
    if (e) out.push(e);
  }
  return out;
}
