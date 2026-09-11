/**
 * myhhub/stock (InStock) 选股策略移植。
 *
 * 协议参考：myhhub-stock/instock/core/strategy/*.py（子模块）。
 * 规则注释保留中文原文，便于对照；实现改为本仓 Candle 纯函数。
 *
 * 注意：部分规则依赖成交额（amount），Candle.amount 可能为 0，
 * 此时用 close*volume 近似；近似失败则视为条件不满足（宁缺毋滥）。
 */
import type { Candle } from '@/data/api';
import { closes, highs, lows, sma, volumes } from '@/quant/indicators';
import { detectPatterns, patternNetScore } from '@/quant/patterns';
import type { FactorDef, FactorResult } from '../types';

function pctChange(candles: Candle[]): number[] {
  const c = closes(candles);
  return c.map((v, i) => (i === 0 || !c[i - 1] ? 0 : ((v - c[i - 1]) / c[i - 1]) * 100));
}

function lastAmount(c: Candle): number {
  if (c.amount && c.amount > 0) return c.amount;
  return c.close * c.volume;
}

/** 放量上涨（enter.py）
 * 1.当日比前一天上涨小于2%或收盘价小于开盘价 → 实际源码是 p_change < 2 为 FALSE 条件里的「不满足」；
 *   原文注释与实现有出入，此处按实现：p_change >= 2 且 close > open
 * 2.当日成交额不低于2亿
 * 3.当日成交量/5日平均成交量>=2
 */
export function checkVolumeSurge(candles: Candle[], minAmountYi = 2, volRatio = 2): boolean {
  if (candles.length < 8) return false;
  const i = candles.length - 1;
  const c = candles[i];
  const pChg = i > 0 && candles[i - 1].close > 0 ? ((c.close - candles[i - 1].close) / candles[i - 1].close) * 100 : 0;
  if (pChg < 2 || c.close < c.open) return false;
  if (lastAmount(c) < minAmountYi * 1e8) return false;
  const volMa = sma(volumes(candles), 5);
  const mean = volMa[i - 1]; // 用前一日 MA5，与 python 的 tail 后 head 语义接近
  if (!mean || mean <= 0) return false;
  return c.volume / mean >= volRatio;
}

/** 海龟交易：当日收盘 >= 最近 N 日最高收盘 */
export function checkTurtle(candles: Candle[], threshold = 60): boolean {
  if (candles.length < threshold) return false;
  const c = closes(candles).slice(-threshold);
  const last = c[c.length - 1];
  return last >= Math.max(...c);
}

/** 放量跌停：跌>9.5% + 成交额≥2亿 + 量≥5日均量×4 */
export function checkClimaxLimitDown(candles: Candle[], threshold = 60): boolean {
  if (candles.length < threshold + 1) return false;
  const i = candles.length - 1;
  const c = candles[i];
  const pChg = candles[i - 1].close > 0 ? ((c.close - candles[i - 1].close) / candles[i - 1].close) * 100 : 0;
  if (pChg > -9.5) return false;
  if (lastAmount(c) < 2e8) return false;
  const volMa = sma(volumes(candles), 5);
  const mean = volMa[i - 1];
  if (!mean || mean <= 0) return false;
  return c.volume / mean >= 4;
}

/** 均线多头（MA30 持续上行 + 30日涨幅>20%） */
export function checkKeepIncreasing(candles: Candle[], threshold = 30): boolean {
  if (candles.length < threshold + 5) return false;
  const ma = sma(closes(candles), 30).slice(-threshold);
  if (ma.some((v) => !Number.isFinite(v))) return false;
  const step1 = Math.round(threshold / 3);
  const step2 = Math.round((threshold * 2) / 3);
  return ma[0] < ma[step1] && ma[step1] < ma[step2] && ma[step2] < ma[ma.length - 1] && ma[ma.length - 1] > 1.2 * ma[0];
}

/** 平台突破：60日内某日 open < MA60 <= close 且放量；此前收盘与 MA60 偏离在 -5%~20% */
export function checkBreakthroughPlatform(candles: Candle[], threshold = 60): boolean {
  if (candles.length < threshold + 5) return false;
  const ma60 = sma(closes(candles), 60);
  const n = candles.length;
  const start = Math.max(59, n - threshold);
  let breakthroughIdx = -1;
  for (let i = start; i < n; i++) {
    const ma = ma60[i];
    const c = candles[i];
    if (!Number.isFinite(ma) || ma <= 0) continue;
    if (c.open < ma && ma <= c.close) {
      // 放量：量/前5日均量 >= 2，且当日上涨
      const slice = candles.slice(0, i + 1);
      if (checkVolumeSurge(slice)) {
        breakthroughIdx = i;
        break;
      }
    }
  }
  if (breakthroughIdx < 0) return false;
  for (let i = start; i < breakthroughIdx; i++) {
    const ma = ma60[i];
    if (!Number.isFinite(ma) || ma <= 0) continue;
    const dev = (ma - candles[i].close) / ma;
    if (!(dev > -0.05 && dev < 0.2)) return false;
  }
  return true;
}

/** 回踩年线（简化移植）：需 ≥250 根；前段从年线下上穿；后段站上年线且缩量回踩 */
export function checkBacktraceMa250(candles: Candle[], window = 60): boolean {
  if (candles.length < 250 + window) return false;
  const ma250 = sma(closes(candles), 250);
  const data = candles.slice(-(window + 50)).map((c, i) => ({
    c,
    ma: ma250[candles.length - (window + 50) + i],
  }));
  const valid = data.filter((x) => Number.isFinite(x.ma) && x.ma > 0);
  if (valid.length < window) return false;

  let highI = 0;
  for (let i = 1; i < valid.length; i++) if (valid[i].c.close > valid[highI].c.close) highI = i;
  const front = valid.slice(0, highI + 1);
  const end = valid.slice(highI);
  if (front.length < 2) return false;
  if (!(front[0].c.close < front[0].ma && front[front.length - 1].c.close > front[front.length - 1].ma)) return false;

  let lowI = 0;
  for (let i = 1; i < end.length; i++) if (end[i].c.close < end[lowI].c.close) lowI = i;
  for (const x of end) if (x.c.close < x.ma) return false;
  const dayDiff = end.length - 1 - lowI;
  // 用 bar 数近似交易日差（原实现用自然日 10-50）
  if (!(lowI >= 2 && lowI <= 40)) return false;
  const volRatio = end[0].c.volume / (end[lowI].c.volume || 1);
  const backRatio = end[lowI].c.close / end[0].c.close;
  return volRatio > 2 && backRatio < 0.8 && dayDiff >= 0;
}

/** 低 ATR 成长：近10日振幅不过大，但区间高低差 > 1.1 倍（相对最低） */
export function checkLowAtrGrowth(candles: Candle[], maLong = 250, threshold = 10): boolean {
  if (candles.length < maLong + threshold) return false;
  const tail = candles.slice(-threshold);
  const pcts = pctChange(candles).slice(-threshold);
  let total = 0;
  for (const p of pcts) total += Math.abs(p);
  if (total / threshold > 10) return false;
  const cl = closes(tail);
  const hi = Math.max(...cl);
  const lo = Math.min(...cl);
  return lo > 0 && (hi - lo) / lo > 1.1;
}

/** 高而窄旗形：近24~10日最低价，当日 close/低 ≥1.9，且窗口内曾连续两天涨≥9.5% */
export function checkHighTightFlag(candles: Candle[], threshold = 60): boolean {
  if (candles.length < threshold) return false;
  const win = candles.slice(-24, -10); // tail 24 head 14
  if (win.length < 10) return false;
  const low = Math.min(...lows(win));
  const last = candles[candles.length - 1];
  if (low <= 0 || last.close / low < 1.9) return false;
  const pcts = pctChange(win);
  let prev = 0;
  for (const p of pcts) {
    if (p >= 9.5) {
      if (prev >= 9.5) return true;
      prev = p;
    } else {
      prev = 0;
    }
  }
  return false;
}

/** 停机坪（parking_apron.py）
 * 1.最近15日有涨幅>9.5%，且当日放量上涨（海龟新高）
 * 2.次日高开、收涨、开收比在 0.97~1.03
 * 3.再 2 日同样高开收涨、涨跌幅 ±5% 内，开收都高于涨停收盘价
 */
export function checkParkingApron(candles: Candle[], window = 15): boolean {
  if (candles.length < window + 10) return false;
  const data = candles.slice(-window);
  const pcts = pctChange(candles).slice(-window);
  for (let i = 0; i < data.length; i++) {
    if (pcts[i] <= 9.5) continue;
    // 涨停日需满足放量上涨 + 海龟（以该日为终点的窗口）
    const upTo = candles.slice(0, candles.length - window + i + 1);
    if (!checkVolumeSurge(upTo) && !checkTurtle(upTo, Math.min(60, upTo.length))) continue;
    const limitClose = data[i].close;
    const rest = data.slice(i + 1, i + 4);
    if (rest.length < 3) continue;
    const d1 = rest[0];
    if (!(d1.close > limitClose && d1.open > limitClose && d1.open > 0)) continue;
    const r1 = d1.close / d1.open;
    if (!(r1 > 0.97 && r1 < 1.03)) continue;
    let ok = true;
    for (let k = 1; k < 3; k++) {
      const d = rest[k];
      const ratio = d.open > 0 ? d.close / d.open : 0;
      const pChg = pcts[i + 1 + k];
      if (!(ratio > 0.97 && ratio < 1.03 && pChg > -5 && pChg < 5 && d.close > limitClose && d.open > limitClose)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** 无大幅回撤（low_backtrace_increase.py）
 * 1.60日收盘涨幅 ≥ 60%
 * 2.期间不得：单日跌超7% / 高开低走7% / 两日累计跌10% / 两日高开低走累计10%
 */
export function checkLowBacktraceIncrease(candles: Candle[], threshold = 60): boolean {
  if (candles.length < threshold) return false;
  const data = candles.slice(-threshold);
  const first = data[0].close;
  const last = data[data.length - 1].close;
  if (first <= 0 || (last - first) / first < 0.6) return false;
  const pcts = pctChange(candles).slice(-threshold);
  let prevPct = 100;
  let prevOpen = -1e9;
  for (let i = 0; i < data.length; i++) {
    const p = pcts[i];
    const c = data[i];
    const openDrop = c.open > 0 ? ((c.close - c.open) / c.open) * 100 : 0;
    const crossOpen = prevOpen > 0 ? ((c.close - prevOpen) / prevOpen) * 100 : 0;
    if (p < -7 || openDrop < -7 || prevPct + p < -10 || crossOpen < -10) return false;
    prevPct = p;
    prevOpen = c.open;
  }
  return true;
}

/* ------------------------------ FactorDef 注册 ------------------------------ */

export const volumeSurgeFactor: FactorDef = {
  id: 'myh_volume_surge',
  label: '放量上涨',
  group: 'volume',
  params: [
    { key: 'minAmountYi', label: '最小成交额(亿)', default: 2, min: 0.5, max: 20, step: 0.5 },
    { key: 'volRatio', label: '量比阈值', default: 2, min: 1, max: 8, step: 0.5 },
  ],
  evaluate(candles, p): FactorResult | null {
    if (candles.length < 8) return null;
    const hit = checkVolumeSurge(candles, p.minAmountYi ?? 2, p.volRatio ?? 2);
    return hit
      ? { score: 1, reason: '放量上涨（量比+成交额）', triggered: true, triggerSide: 'buy' }
      : { score: 0, reason: '未满足放量上涨' };
  },
};

export const turtleBreakoutFactor: FactorDef = {
  id: 'myh_turtle',
  label: '海龟突破',
  group: 'trend',
  params: [{ key: 'days', label: '突破窗口', default: 60, min: 20, max: 120, step: 1 }],
  evaluate(candles, p): FactorResult | null {
    const n = Math.round(p.days ?? 60);
    if (candles.length < n) return null;
    const hit = checkTurtle(candles, n);
    return hit
      ? { score: 1, reason: `收盘≥${n}日最高`, triggered: true, triggerSide: 'buy' }
      : { score: 0, reason: '未创区间新高' };
  },
};

export const climaxLimitDownFactor: FactorDef = {
  id: 'myh_climax_limitdown',
  label: '放量跌停',
  group: 'volume',
  params: [{ key: 'dropPct', label: '跌幅阈值%', default: 9.5, min: 5, max: 12, step: 0.5 }],
  evaluate(candles, p): FactorResult | null {
    if (candles.length < 20) return null;
    const hit = checkClimaxLimitDown(candles);
    const drop = p.dropPct ?? 9.5;
    const i = candles.length - 1;
    const pChg =
      candles[i - 1].close > 0
        ? ((candles[i].close - candles[i - 1].close) / candles[i - 1].close) * 100
        : 0;
    if (pChg <= -drop && hit) {
      return { score: -1, reason: '放量跌停（风险）', triggered: true, triggerSide: 'sell' };
    }
    return { score: 0, reason: '无放量跌停' };
  },
};

export const keepIncreasingFactor: FactorDef = {
  id: 'myh_keep_increasing',
  label: '均线多头',
  group: 'trend',
  params: [{ key: 'period', label: '均线周期', default: 30, min: 10, max: 60, step: 1 }],
  evaluate(candles, p): FactorResult | null {
    const n = Math.round(p.period ?? 30);
    if (candles.length < n + 10) return null;
    const hit = checkKeepIncreasing(candles, n);
    return hit
      ? { score: 1, reason: 'MA30 多头且 30 日涨幅>20%', triggered: true, triggerSide: 'buy' }
      : { score: 0, reason: '均线未形成多头' };
  },
};

export const platformBreakoutFactor: FactorDef = {
  id: 'myh_platform_breakout',
  label: '平台突破',
  group: 'trend',
  params: [{ key: 'days', label: '平台窗口', default: 60, min: 20, max: 120, step: 1 }],
  evaluate(candles, p): FactorResult | null {
    const n = Math.round(p.days ?? 60);
    if (candles.length < n + 10) return null;
    const hit = checkBreakthroughPlatform(candles, n);
    return hit
      ? { score: 1, reason: '平台突破（MA60 放量上穿）', triggered: true, triggerSide: 'buy' }
      : { score: 0, reason: '未突破平台' };
  },
};

export const backtraceMa250Factor: FactorDef = {
  id: 'myh_backtrace_ma250',
  label: '回踩年线',
  group: 'trend',
  params: [{ key: 'window', label: '观察窗口', default: 60, min: 30, max: 120, step: 5 }],
  evaluate(candles, p): FactorResult | null {
    const w = Math.round(p.window ?? 60);
    if (candles.length < 250 + w) return null;
    const hit = checkBacktraceMa250(candles, w);
    return hit
      ? { score: 1, reason: '回踩年线缩量', triggered: true, triggerSide: 'buy' }
      : { score: 0, reason: '未出现回踩年线形态' };
  },
};

export const lowAtrGrowthFactor: FactorDef = {
  id: 'myh_low_atr',
  label: '低波动成长',
  group: 'volatility',
  params: [{ key: 'days', label: '观察日', default: 10, min: 5, max: 30, step: 1 }],
  evaluate(candles, p): FactorResult | null {
    const n = Math.round(p.days ?? 10);
    if (candles.length < 250 + n) return null;
    const hit = checkLowAtrGrowth(candles, 250, n);
    return hit
      ? { score: 1, reason: '低波动但区间抬升', triggered: true, triggerSide: 'buy' }
      : { score: 0, reason: '不满足低波动成长' };
  },
};

export const highTightFlagFactor: FactorDef = {
  id: 'myh_high_tight_flag',
  label: '高而窄旗形',
  group: 'momentum',
  params: [{ key: 'ratio', label: '涨幅倍数', default: 1.9, min: 1.3, max: 3, step: 0.1 }],
  evaluate(candles, p): FactorResult | null {
    if (candles.length < 60) return null;
    const need = p.ratio ?? 1.9;
    // 简化：用 checkHighTightFlag，再按 ratio 参数覆盖 1.9 阈值
    const win = candles.slice(-24, -10);
    const last = candles[candles.length - 1];
    const low = win.length ? Math.min(...lows(win)) : 0;
    const base = checkHighTightFlag(candles);
    const hit = base || (low > 0 && last.close / low >= need);
    return hit
      ? { score: 1, reason: '高而窄旗形', triggered: true, triggerSide: 'buy' }
      : { score: 0, reason: '非高窄旗形' };
  },
};

export const parkingApronFactor: FactorDef = {
  id: 'myh_parking_apron',
  label: '停机坪',
  group: 'trend',
  params: [{ key: 'window', label: '观察窗', default: 15, min: 10, max: 30, step: 1 }],
  evaluate(candles, p): FactorResult | null {
    const w = Math.round(p.window ?? 15);
    if (candles.length < w + 10) return null;
    const hit = checkParkingApron(candles, w);
    return hit
      ? { score: 1, reason: '停机坪：涨停后平台整理', triggered: true, triggerSide: 'buy' }
      : { score: 0, reason: '未形成停机坪' };
  },
};

export const lowBacktraceFactor: FactorDef = {
  id: 'myh_low_backtrace',
  label: '无大幅回撤',
  group: 'trend',
  params: [{ key: 'days', label: '观察日', default: 60, min: 20, max: 120, step: 5 }],
  evaluate(candles, p): FactorResult | null {
    const n = Math.round(p.days ?? 60);
    if (candles.length < n) return null;
    const hit = checkLowBacktraceIncrease(candles, n);
    return hit
      ? { score: 1, reason: '60日上涨且无深回撤', triggered: true, triggerSide: 'buy' }
      : { score: 0, reason: '涨幅不足或回撤过深' };
  },
};

/** K 线形态净信号（对照 InStock pattern_recognitions） */
export const candlePatternFactor: FactorDef = {
  id: 'myh_candle_pattern',
  label: 'K线形态',
  group: 'momentum',
  params: [{ key: 'threshold', label: '触发阈值', default: 60, min: 20, max: 100, step: 5 }],
  evaluate(candles, p): FactorResult | null {
    if (candles.length < 5) return null;
    const th = p.threshold ?? 60;
    const hits = detectPatterns(candles);
    const net = patternNetScore(hits);
    const top = hits[0];
    if (net >= th) {
      return {
        score: Math.min(1, net / 100),
        reason: top ? `形态看涨：${top.label}` : '形态偏多',
        triggered: true,
        triggerSide: 'buy',
      };
    }
    if (net <= -th) {
      return {
        score: Math.max(-1, net / 100),
        reason: top ? `形态看跌：${top.label}` : '形态偏空',
        triggered: true,
        triggerSide: 'sell',
      };
    }
    return { score: net / 100, reason: hits.length ? `形态：${hits.map((h) => h.label).join('、')}` : '无显著形态' };
  },
};

export const MYHHUB_FACTORS: FactorDef[] = [
  volumeSurgeFactor,
  turtleBreakoutFactor,
  climaxLimitDownFactor,
  keepIncreasingFactor,
  platformBreakoutFactor,
  backtraceMa250Factor,
  lowAtrGrowthFactor,
  highTightFlagFactor,
  parkingApronFactor,
  lowBacktraceFactor,
  candlePatternFactor,
];
