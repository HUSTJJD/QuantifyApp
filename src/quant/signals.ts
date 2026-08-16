/**
 * 信号引擎：把多个策略的局部信号合并成某标的的「最终买卖信号」。
 * 纯函数、可单测，不依赖 UI 与存储。
 */
import type { Candle, Quote, Symbol } from '@/api';
import { toFullCode } from '@/domain';
import { STRATEGIES, activeStrategies, type SignalSide, type StrategyConfig } from './strategies';

export interface TradeSignal {
  symbol: Symbol;
  symbolKey: string;
  side: SignalSide;
  /** 综合强度：-3（强卖）~ +3（强买） */
  strength: number;
  /** 命中的策略理由（最多 3 条，按强度降序） */
  reasons: string[];
  /** 信号生成时间（ms） */
  ts: number;
}

const DEFAULT_CFG: StrategyConfig = {
  enabled: Object.fromEntries(STRATEGIES.map((s) => [s.id, s.enabledByDefault])),
};

/**
 * 计算单只标的的信号。
 * @param candles 升序 K 线（日线为主）
 * @param quote   最新行情快照（可选，供突破/涨跌幅用）
 * @param config  策略开关（可选，默认全开）
 */
export function computeSignal(
  symbol: Symbol,
  candles: Candle[],
  quote?: Quote | null,
  config: StrategyConfig = DEFAULT_CFG,
): TradeSignal {
  const parts: { side: SignalSide; reason: string; strength: number }[] = [];
  for (const s of activeStrategies(config)) {
    try {
      const p = s.evaluate(candles, { quote });
      if (p) parts.push(p);
    } catch {
      // 单策略异常不影响整体（如数据不足），跳过
    }
  }

  let score = 0;
  const reasons: string[] = [];
  for (const p of parts) {
    score += p.strength;
    reasons.push(p.reason);
  }
  reasons.sort((a, b) => Math.abs(b.length) - Math.abs(a.length));

  const clamped = Math.max(-3, Math.min(3, score));
  let side: SignalSide = 'hold';
  if (clamped >= 1) side = 'buy';
  else if (clamped <= -1) side = 'sell';

  return {
    symbol,
    symbolKey: toFullCode(symbol),
    side,
    strength: clamped,
    reasons: reasons.slice(0, 3),
    ts: Date.now(),
  };
}
