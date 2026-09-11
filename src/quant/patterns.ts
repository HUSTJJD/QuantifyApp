/**
 * K 线形态识别（纯 TS，无 talib）。
 *
 * 对照 InStock `pattern_recognitions.py` + talib CDL* 语义，
 * 实现高频、可独立判定的子集（约 25 种核心形态）。
 * 返回约定与 InStock 一致：负=看跌 / 0=无 / 正=看涨（量级 0~100）。
 *
 * 完整 61 种需移植 talib C 实现，见 vendor/README-myhhub-stock.md。
 */
import type { Candle } from '@/data/api';

export type PatternSignal = number;

export interface CandlePatternDef {
  id: string;
  label: string;
  /** 最少需要的 K 线根数 */
  minBars: number;
  /** 纯函数：对整段序列计算最后一根的形态信号 */
  detect: (c: Candle[]) => PatternSignal;
}

function body(c: Candle): number {
  return c.close - c.open;
}
function range(c: Candle): number {
  return Math.max(c.high - c.low, 1e-9);
}
function upperShadow(c: Candle): number {
  return c.high - Math.max(c.open, c.close);
}
function lowerShadow(c: Candle): number {
  return Math.min(c.open, c.close) - c.low;
}
function isBull(c: Candle): boolean {
  return c.close > c.open;
}
function isBear(c: Candle): boolean {
  return c.close < c.open;
}
function bodyRatio(c: Candle): number {
  return Math.abs(body(c)) / range(c);
}
function mid(c: Candle): number {
  return (c.high + c.low) / 2;
}

/** 十字 / Doji：实体极小 */
function detectDoji(c: Candle[]): PatternSignal {
  const last = c[c.length - 1];
  return bodyRatio(last) < 0.1 ? 20 : 0;
}

/** 锤头：下跌后出现，下影 ≥2 倍实体，上影很短 */
function detectHammer(c: Candle[]): PatternSignal {
  const n = c.length;
  const last = c[n - 1];
  const prevClose = c[n - 2].close;
  if (last.close > prevClose) return 0;
  const b = Math.max(Math.abs(body(last)), 1e-9);
  if (lowerShadow(last) >= 2 * b && upperShadow(last) < b && bodyRatio(last) < 0.4) return 70;
  return 0;
}

/** 倒锤头 */
function detectInvertedHammer(c: Candle[]): PatternSignal {
  const n = c.length;
  const last = c[n - 1];
  const prevClose = c[n - 2].close;
  if (last.close > prevClose) return 0;
  const b = Math.max(Math.abs(body(last)), 1e-9);
  if (upperShadow(last) >= 2 * b && lowerShadow(last) < b * 0.5) return 55;
  return 0;
}

/** 上吊线：上涨后锤头形态 → 看跌 */
function detectHangingMan(c: Candle[]): PatternSignal {
  const n = c.length;
  const last = c[n - 1];
  const prevClose = c[n - 2].close;
  if (last.close < prevClose) return 0;
  const b = Math.max(Math.abs(body(last)), 1e-9);
  if (lowerShadow(last) >= 2 * b && upperShadow(last) < b) return -60;
  return 0;
}

/** 射击之星：上涨后上影锤 */
function detectShootingStar(c: Candle[]): PatternSignal {
  const n = c.length;
  const last = c[n - 1];
  const prevClose = c[n - 2].close;
  if (last.close < prevClose) return 0;
  const b = Math.max(Math.abs(body(last)), 1e-9);
  if (upperShadow(last) >= 2 * b && lowerShadow(last) < b * 0.5) return -70;
  return 0;
}

/** 看涨吞没 */
function detectBullishEngulfing(c: Candle[]): PatternSignal {
  const a = c[c.length - 2];
  const b = c[c.length - 1];
  if (isBear(a) && isBull(b) && b.close >= a.open && b.open <= a.close && body(b) > body(a)) return 80;
  return 0;
}

/** 看跌吞没 */
function detectBearishEngulfing(c: Candle[]): PatternSignal {
  const a = c[c.length - 2];
  const b = c[c.length - 1];
  if (isBull(a) && isBear(b) && b.open >= a.close && b.close <= a.open && Math.abs(body(b)) > Math.abs(body(a)))
    return -80;
  return 0;
}

/** 乌云压顶 */
function detectDarkCloudCover(c: Candle[]): PatternSignal {
  const a = c[c.length - 2];
  const b = c[c.length - 1];
  if (!isBull(a) || !isBear(b)) return 0;
  if (b.open > a.close && b.close < mid(a) && b.close > a.open) return -65;
  return 0;
}

/** 刺透形态 */
function detectPiercing(c: Candle[]): PatternSignal {
  const a = c[c.length - 2];
  const b = c[c.length - 1];
  if (!isBear(a) || !isBull(b)) return 0;
  if (b.open < a.close && b.close > mid(a) && b.close < a.open) return 65;
  return 0;
}

/** 晨星 */
function detectMorningStar(c: Candle[]): PatternSignal {
  const [a, b, d] = [c[c.length - 3], c[c.length - 2], c[c.length - 1]];
  if (!isBear(a) || bodyRatio(b) > 0.4 || !isBull(d)) return 0;
  if (d.close > mid(a) && b.close < Math.min(a.close, a.open)) return 85;
  return 0;
}

/** 暮星 */
function detectEveningStar(c: Candle[]): PatternSignal {
  const [a, b, d] = [c[c.length - 3], c[c.length - 2], c[c.length - 1]];
  if (!isBull(a) || bodyRatio(b) > 0.4 || !isBear(d)) return 0;
  if (d.close < mid(a) && b.close > Math.max(a.close, a.open)) return -85;
  return 0;
}

/** 三白兵 */
function detectThreeWhiteSoldiers(c: Candle[]): PatternSignal {
  const [a, b, d] = [c[c.length - 3], c[c.length - 2], c[c.length - 1]];
  if (isBull(a) && isBull(b) && isBull(d) && b.close > a.close && d.close > b.close && b.open > a.open && d.open > b.open)
    return 75;
  return 0;
}

/** 三乌鸦 */
function detectThreeBlackCrows(c: Candle[]): PatternSignal {
  const [a, b, d] = [c[c.length - 3], c[c.length - 2], c[c.length - 1]];
  if (isBear(a) && isBear(b) && isBear(d) && b.close < a.close && d.close < b.close) return -75;
  return 0;
}

/** 孕线 Harami */
function detectHarami(c: Candle[]): PatternSignal {
  const a = c[c.length - 2];
  const b = c[c.length - 1];
  const bIn =
    Math.max(b.open, b.close) <= Math.max(a.open, a.close) &&
    Math.min(b.open, b.close) >= Math.min(a.open, a.close) &&
    Math.abs(body(b)) < Math.abs(body(a)) * 0.6;
  if (!bIn) return 0;
  if (isBear(a) && isBull(b)) return 40;
  if (isBull(a) && isBear(b)) return -40;
  return 0;
}

/** 吞噬的另一面：十字孕线 */
function detectHaramiCross(c: Candle[]): PatternSignal {
  const a = c[c.length - 2];
  const b = c[c.length - 1];
  if (bodyRatio(b) > 0.15) return 0;
  const bIn =
    Math.max(b.open, b.close) <= Math.max(a.open, a.close) &&
    Math.min(b.open, b.close) >= Math.min(a.open, a.close);
  if (!bIn) return 0;
  return isBear(a) ? 50 : -50;
}

/** 光头光脚 Marubozu */
function detectMarubozu(c: Candle[]): PatternSignal {
  const last = c[c.length - 1];
  if (upperShadow(last) / range(last) < 0.05 && lowerShadow(last) / range(last) < 0.05) {
    return isBull(last) ? 60 : -60;
  }
  return 0;
}

/** 捉腰带线 Belthold */
function detectBelthold(c: Candle[]): PatternSignal {
  const last = c[c.length - 1];
  if (isBull(last) && lowerShadow(last) < range(last) * 0.1 && upperShadow(last) > range(last) * 0.3) return 45;
  if (isBear(last) && upperShadow(last) < range(last) * 0.1 && lowerShadow(last) > range(last) * 0.3) return -45;
  return 0;
}

/** 蜻蜓十字 / 墓碑十字 */
function detectDragonflyGravestone(c: Candle[]): PatternSignal {
  const last = c[c.length - 1];
  if (bodyRatio(last) > 0.1) return 0;
  if (lowerShadow(last) > range(last) * 0.7 && upperShadow(last) < range(last) * 0.1) return 50;
  if (upperShadow(last) > range(last) * 0.7 && lowerShadow(last) < range(last) * 0.1) return -50;
  return 0;
}

/** 上升/下降三法（简化：中段小实体回调） */
function detectRiseFall3Methods(c: Candle[]): PatternSignal {
  if (c.length < 5) return 0;
  const first = c[c.length - 5];
  const last = c[c.length - 1];
  const mid3 = c.slice(c.length - 4, c.length - 1);
  if (isBull(first) && isBull(last) && last.close > first.close) {
    const allSmall = mid3.every((x) => Math.abs(body(x)) < Math.abs(body(first)) * 0.5 && isBear(x));
    if (allSmall) return 60;
  }
  if (isBear(first) && isBear(last) && last.close < first.close) {
    const allSmall = mid3.every((x) => Math.abs(body(x)) < Math.abs(body(first)) * 0.5 && isBull(x));
    if (allSmall) return -60;
  }
  return 0;
}

/** 分离线 */
function detectSeparatingLines(c: Candle[]): PatternSignal {
  const a = c[c.length - 2];
  const b = c[c.length - 1];
  if (Math.abs(a.open - b.open) / a.open < 0.002) {
    if (isBull(a) && isBull(b) && a.close < a.open && b.close > b.open) return 40;
    if (isBear(a) && isBear(b) && a.close > a.open && b.close < b.open) return -40;
  }
  return 0;
}

/** 停顿形态 Stalled */
function detectStalled(c: Candle[]): PatternSignal {
  const [a, b, d] = [c[c.length - 3], c[c.length - 2], c[c.length - 1]];
  if (!(isBull(a) && isBull(b) && isBull(d))) return 0;
  if (body(b) < body(a) * 0.5 && body(d) < body(b) * 0.5 && d.close > b.close) return -35;
  return 0;
}

/** 长脚十字 */
function detectLongLeggedDoji(c: Candle[]): PatternSignal {
  const last = c[c.length - 1];
  if (bodyRatio(last) < 0.08 && range(last) > 0) {
    const avgRange =
      c.slice(-6, -1).reduce((s, x) => s + range(x), 0) / Math.max(c.length - 1, 1);
    if (range(last) > avgRange * 1.5) return 25;
  }
  return 0;
}

/** 跳空并列阳线 */
function detectGapSideSideWhite(c: Candle[]): PatternSignal {
  const a = c[c.length - 2];
  const b = c[c.length - 1];
  if (isBull(a) && isBull(b) && b.low > a.high && Math.abs(a.close - b.close) / a.close < 0.01) return 35;
  return 0;
}

export const CANDLE_PATTERNS: CandlePatternDef[] = [
  { id: 'doji', label: '十字', minBars: 1, detect: detectDoji },
  { id: 'hammer', label: '锤头', minBars: 2, detect: detectHammer },
  { id: 'inverted_hammer', label: '倒锤头', minBars: 2, detect: detectInvertedHammer },
  { id: 'hanging_man', label: '上吊线', minBars: 2, detect: detectHangingMan },
  { id: 'shooting_star', label: '射击之星', minBars: 2, detect: detectShootingStar },
  { id: 'bullish_engulfing', label: '看涨吞没', minBars: 2, detect: detectBullishEngulfing },
  { id: 'bearish_engulfing', label: '看跌吞没', minBars: 2, detect: detectBearishEngulfing },
  { id: 'dark_cloud', label: '乌云压顶', minBars: 2, detect: detectDarkCloudCover },
  { id: 'piercing', label: '刺透形态', minBars: 2, detect: detectPiercing },
  { id: 'morning_star', label: '晨星', minBars: 3, detect: detectMorningStar },
  { id: 'evening_star', label: '暮星', minBars: 3, detect: detectEveningStar },
  { id: 'three_white_soldiers', label: '三白兵', minBars: 3, detect: detectThreeWhiteSoldiers },
  { id: 'three_black_crows', label: '三乌鸦', minBars: 3, detect: detectThreeBlackCrows },
  { id: 'harami', label: '母子线', minBars: 2, detect: detectHarami },
  { id: 'harami_cross', label: '十字孕线', minBars: 2, detect: detectHaramiCross },
  { id: 'marubozu', label: '光头光脚', minBars: 1, detect: detectMarubozu },
  { id: 'belthold', label: '捉腰带线', minBars: 1, detect: detectBelthold },
  { id: 'dragonfly_gravestone', label: '蜻蜓/墓碑十字', minBars: 1, detect: detectDragonflyGravestone },
  { id: 'rise_fall_3', label: '上升/下降三法', minBars: 5, detect: detectRiseFall3Methods },
  { id: 'separating_lines', label: '分离线', minBars: 2, detect: detectSeparatingLines },
  { id: 'stalled', label: '停顿形态', minBars: 3, detect: detectStalled },
  { id: 'long_legged_doji', label: '长脚十字', minBars: 6, detect: detectLongLeggedDoji },
  { id: 'gap_side_white', label: '跳空并列阳线', minBars: 2, detect: detectGapSideSideWhite },
];

export interface PatternHit {
  id: string;
  label: string;
  signal: PatternSignal;
}

/** 对最新一根 K 线跑全部形态 */
export function detectPatterns(candles: Candle[]): PatternHit[] {
  if (candles.length < 2) return [];
  const out: PatternHit[] = [];
  for (const p of CANDLE_PATTERNS) {
    if (candles.length < p.minBars) continue;
    try {
      const sig = p.detect(candles);
      if (sig !== 0) out.push({ id: p.id, label: p.label, signal: sig });
    } catch {
      // 单形态异常不影响其它
    }
  }
  return out.sort((a, b) => Math.abs(b.signal) - Math.abs(a.signal));
}

/** 汇总净信号（正偏多 / 负偏空） */
export function patternNetScore(hits: PatternHit[]): number {
  return hits.reduce((s, h) => s + h.signal, 0);
}
