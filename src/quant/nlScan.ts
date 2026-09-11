/**
 * 轻量 NL 筛股：中文关键词 → 尾盘/扫描套餐（同花顺问财的极简版）。
 * 只做意图识别 + 跳转，不做完整自然语言解析。
 */
import type { EodPresetId } from '@/domain';

export interface NlScanMatch {
  /** 展示文案 */
  label: string;
  hint: string;
  presetId: EodPresetId;
  /** 额外可选条件（由调用方并入 scan criteria） */
  extra?: {
    volumeSpikeRatio?: number;
    /** 缩量：量比 ≤ 该值（与 volumeSpikeRatio 互斥语义） */
    volumeShrinkRatio?: number;
    newHighDays?: number;
    newLowDays?: number;
    minGainPct?: number;
    maxGainPct?: number;
    macdGoldenCross?: boolean;
    maBullish?: boolean;
    /** 偏空意图（死叉/空头/跌破等），仅作观察，不视为买入信号 */
    bearish?: boolean;
    /** 低估值（PE/PB 低位） */
    undervalued?: boolean;
    /** 高股息 */
    highDividend?: boolean;
    /** 北向净流入 */
    northbound?: boolean;
    /** 业绩预增 */
    earningsUp?: boolean;
    /** 小盘 */
    smallCap?: boolean;
    /** 次新 */
    subNew?: boolean;
  };
}

const RULES: Array<{ keys: string[]; match: NlScanMatch }> = [
  {
    keys: ['放量', '量比', '巨量', '成交量放大', '量价齐升'],
    match: {
      label: '扫描：放量突破',
      hint: '量比≥2 · 涨幅 1%~7%',
      presetId: 'volume_breakout',
      extra: { volumeSpikeRatio: 2, minGainPct: 1 },
    },
  },
  {
    keys: ['缩量', '地量', '缩量回踩'],
    match: {
      label: '扫描：缩量回踩',
      hint: '量比≤0.6 · 回踩不破',
      presetId: 'volume_breakout',
      extra: { volumeShrinkRatio: 0.6, maxGainPct: 3 },
    },
  },
  {
    keys: ['金叉', 'macd金叉', 'MACD'],
    match: {
      label: '扫描：MACD 金叉',
      hint: '金叉确认 · RSI 20~70',
      presetId: 'golden_confirm',
      extra: { macdGoldenCross: true },
    },
  },
  {
    keys: ['死叉', 'macd死叉'],
    match: {
      label: '观察：MACD 死叉',
      hint: '回避/减仓观察',
      presetId: 'golden_confirm',
      extra: { macdGoldenCross: false, bearish: true },
    },
  },
  {
    keys: ['多头', '均线多头', '多头排列', '均线多头排列'],
    match: {
      label: '扫描：均线多头',
      hint: 'MA5>MA10>MA20',
      presetId: 'pullback_ma',
      extra: { maBullish: true },
    },
  },
  {
    keys: ['空头', '均线空头', '空头排列'],
    match: {
      label: '观察：均线空头',
      hint: '回避/观望',
      presetId: 'pullback_ma',
      extra: { maBullish: false, bearish: true },
    },
  },
  {
    keys: ['突破', '放量突破', '平台突破'],
    match: {
      label: '扫描：突破',
      hint: '放量站上平台',
      presetId: 'volume_breakout',
      extra: { volumeSpikeRatio: 1.5, minGainPct: 2 },
    },
  },
  {
    keys: ['新高', '突破新高', '创阶段新高', '20日新高', '阶段新高'],
    match: {
      label: '扫描：20 日新高',
      hint: '收盘创近 20 日新高',
      presetId: 'volume_breakout',
      extra: { newHighDays: 20 },
    },
  },
  {
    keys: ['新低', '创阶段新低', '20日新低'],
    match: {
      label: '观察：20 日新低',
      hint: '超跌观察',
      presetId: 'volume_breakout',
      extra: { newLowDays: 20, bearish: true },
    },
  },
  {
    keys: ['止跌', '止跌企稳', '企稳'],
    match: {
      label: '扫描：止跌企稳',
      hint: '缩量止跌 · 站上均线',
      presetId: 'pullback_ma',
      extra: { maBullish: true, volumeShrinkRatio: 0.8 },
    },
  },
  {
    keys: ['低估值', '低估', '低pe', '低pb', '便宜'],
    match: {
      label: '扫描：低估值',
      hint: 'PE/PB 低位',
      presetId: 'volume_breakout',
      extra: { undervalued: true },
    },
  },
  {
    keys: ['高股息', '股息', '分红高', '高分红'],
    match: {
      label: '扫描：高股息',
      hint: '股息率靠前',
      presetId: 'volume_breakout',
      extra: { highDividend: true },
    },
  },
  {
    keys: ['北向', '外资', '北向流入', '外资流入'],
    match: {
      label: '扫描：北向净流入',
      hint: '北向增持',
      presetId: 'volume_breakout',
      extra: { northbound: true },
    },
  },
  {
    keys: ['业绩', '业绩预增', '预增', '财报预增'],
    match: {
      label: '扫描：业绩预增',
      hint: '预告净利润高增',
      presetId: 'volume_breakout',
      extra: { earningsUp: true },
    },
  },
  {
    keys: ['小盘', '小市值', '微型股'],
    match: {
      label: '扫描：小盘股',
      hint: '市值偏小',
      presetId: 'volume_breakout',
      extra: { smallCap: true },
    },
  },
  {
    keys: ['次新', '次新股'],
    match: {
      label: '扫描：次新股',
      hint: '上市半年内',
      presetId: 'volume_breakout',
      extra: { subNew: true },
    },
  },
  {
    keys: ['涨停', '打板', '连板'],
    match: {
      label: '观察：涨停/连板',
      hint: '连板强度观察',
      presetId: 'volume_breakout',
      extra: { volumeSpikeRatio: 2, minGainPct: 9, bearish: true },
    },
  },
  {
    keys: ['跌停', '跌停板'],
    match: {
      label: '观察：跌停',
      hint: '风险规避观察',
      presetId: 'volume_breakout',
      extra: { bearish: true },
    },
  },
  {
    keys: ['尾盘', '尾盘股', '尾盘选股'],
    match: {
      label: '打开：尾盘选股',
      hint: '套餐卡片流',
      presetId: 'volume_breakout',
    },
  },
];

/** 从搜索词识别扫描意图；无匹配返回 null */
export function matchNlScan(keyword: string): NlScanMatch | null {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return null;
  for (const rule of RULES) {
    const hit = rule.keys.some((k) => {
      const kl = k.toLowerCase();
      // (a) 关键词包含完整意图词，或 (b) 短词（≥2 字）被某意图词包含
      return kw.includes(kl) || (kw.length >= 2 && kl.includes(kw));
    });
    if (hit) return rule.match;
  }
  return null;
}

export const NL_SCAN_HINTS = [
  '放量',
  '缩量回踩',
  '金叉',
  '均线多头',
  '突破',
  '20日新高',
  '低估值',
  '高股息',
  '北向净流入',
  '业绩预增',
  '小盘',
  '次新',
  '尾盘选股',
];
