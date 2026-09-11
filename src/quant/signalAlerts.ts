/**
 * 信号告警：把策略 buy/sell 信号转成 AlertEvent，接入既有告警中心。
 *
 * 纯函数，不依赖 UI / 存储：
 *  - `signalToAlertEvent`：单条 TradeSignal → AlertEvent（hold 返回 null）
 *  - `signalsToAlertEvents`：批量转换 + 按策略开关过滤
 *
 * 去重复用 alertHistory 的 dedupeKey（同天+同标的+同规则），规则 id 形如 `signal_<strategyId>`。
 */
import type { TradeSignal } from '@/quant/signals';
import type { AlertEvent } from '@/features/watchlist/alerts';

/** 信号告警的规则 id 前缀 */
export const SIGNAL_RULE_PREFIX = 'signal_';

/** 生成信号告警的规则 id */
export function signalRuleId(contributionId: string): string {
  return `${SIGNAL_RULE_PREFIX}${contributionId}`;
}

/**
 * 单条 TradeSignal → AlertEvent。
 * hold 或强度不足返回 null。
 * @param minStrength 最低强度绝对值（默认 1，与信号引擎阈值一致）
 */
export function signalToAlertEvent(sig: TradeSignal, minStrength = 1): AlertEvent | null {
  if (sig.side === 'hold') return null;
  if (Math.abs(sig.strength) < minStrength) return null;
  // 取强度最大的贡献策略作为规则 id（多策略时用最高强度者）
  const top = [...sig.contributions].sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength))[0];
  const ruleId = top ? signalRuleId(top.id) : signalRuleId('composite');
  const dir = sig.side === 'buy' ? '买入' : '卖出';
  return {
    ruleId,
    type: 'pct', // 复用 pct 类型（告警中心不区分来源），语义上是"信号"
    symbol: sig.symbol,
    value: sig.strength,
    message: `${dir}信号（强度 ${sig.strength.toFixed(1)}）· ${sig.reasons.slice(0, 2).join('、')}`,
    time: sig.ts,
  };
}

/**
 * 批量转换：按策略开关过滤后转 AlertEvent。
 * @param signals 信号列表
 * @param enabledStrategyIds 允许告警的策略 id 集合；undefined = 全部允许
 * @param minStrength 最低强度
 */
export function signalsToAlertEvents(
  signals: TradeSignal[],
  enabledStrategyIds?: Set<string>,
  minStrength = 1,
): AlertEvent[] {
  const out: AlertEvent[] = [];
  for (const sig of signals) {
    const e = signalToAlertEvent(sig, minStrength);
    if (!e) continue;
    // 按策略开关过滤：取 ruleId 中的策略 id 部分
    if (enabledStrategyIds) {
      const strategyId = e.ruleId.slice(SIGNAL_RULE_PREFIX.length);
      if (!enabledStrategyIds.has(strategyId)) continue;
    }
    out.push(e);
  }
  return out;
}
