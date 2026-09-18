/**
 * 档案驱动的信号计算（纯函数）。
 * 输入：StrategyProfile 列表 + 标的 K 线；输出：各档案对标的的 TradeSignal。
 */
import type { Candle, Quote, Symbol } from '@/data/api';
import type { SignalContribution, TradeSignal } from '@/domain';
import { symbolKey } from '@/domain';
import { evaluateProfile, legLabel, type StrategyProfile } from './profile';

export type { TradeSignal } from '@/domain';

/** 回测/详情页用的轻量 evaluate 接口 */
export function computeProfileSignal(
  profile: StrategyProfile,
  symbol: Symbol,
  candles: Candle[],
  quote?: Quote | null,
): TradeSignal | null {
  if (!profile.enabled) return null;
  const enabledLegs = profile.legs.filter((l) => l.enabled);
  if (enabledLegs.length === 0) return null;

  // 贡献明细：逐腿评估（与 combine 内部一致，便于 UI 展示）
  const contributions: SignalContribution[] = [];
  for (const leg of enabledLegs) {
    const partial = evaluateLegForDisplay(profile, leg.templateId, candles);
    if (partial) {
      contributions.push({
        templateId: leg.templateId,
        label: legLabel(leg),
        side: partial.side,
        strength: partial.strength,
        weight: leg.weight,
        reason: partial.reason,
      });
    }
  }

  const combined = evaluateProfile(profile, candles, quote);
  if (!combined || combined.side === 'hold') return null;

  return {
    symbol,
    symbolKey: symbolKey(symbol),
    side: combined.side,
    strength: combined.strength,
    profileId: profile.id,
    profileName: profile.name,
    reasons: [combined.reason],
    contributions,
    ts: Date.now(),
  };
}

function evaluateLegForDisplay(
  profile: StrategyProfile,
  templateId: string,
  candles: Candle[],
): { side: TradeSignal['side']; strength: number; reason: string } | null {
  // 复用 profile 的腿求值：构造单腿临时档案代价高，直接再 evaluate 一次
  const single: StrategyProfile = {
    ...profile,
    legs: profile.legs.filter((l) => l.templateId === templateId && l.enabled),
    combineMode: 'or',
  };
  const sig = evaluateProfile(single, candles);
  if (!sig) return null;
  return { side: sig.side, strength: sig.strength, reason: sig.reason };
}

/** 对一组启用档案分别计算，返回全部有效信号 */
export function computeSignalsForProfiles(
  profiles: StrategyProfile[],
  symbol: Symbol,
  candles: Candle[],
  quote?: Quote | null,
): TradeSignal[] {
  const out: TradeSignal[] = [];
  for (const p of profiles) {
    const sig = computeProfileSignal(p, symbol, candles, quote);
    if (sig) out.push(sig);
  }
  return out;
}

/** 取强度最大的一条（详情页决策卡用） */
export function bestSignal(signals: TradeSignal[]): TradeSignal | undefined {
  if (signals.length === 0) return undefined;
  return signals.reduce((a, b) => (Math.abs(b.strength) > Math.abs(a.strength) ? b : a));
}

/** 兼容入口名：基于启用档案计算某标的信号（详情页） */
export function computeSignals(
  symbol: Symbol,
  candles: Candle[],
  quote: Quote | null | undefined,
  profiles: StrategyProfile[],
): TradeSignal[] {
  return computeSignalsForProfiles(profiles.filter((p) => p.enabled), symbol, candles, quote);
}
