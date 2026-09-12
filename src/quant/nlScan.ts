/**
 * 轻量 NL 筛股：中文关键词 → 尾盘/扫描套餐（同花顺问财的极简版）。
 * 只做意图识别 + 跳转，不做完整自然语言解析。
 */
import type { EodPresetId } from '@/features/scanner/EodPickerScreen';

export interface NlScanMatch {
  /** 展示文案 */
  label: string;
  hint: string;
  presetId: EodPresetId;
  /** 额外可选条件（由调用方并入 scan criteria） */
  extra?: {
    volumeSpikeRatio?: number;
    newHighDays?: number;
    minGainPct?: number;
    macdGoldenCross?: boolean;
    maBullish?: boolean;
  };
}

const RULES: Array<{ keys: string[]; match: NlScanMatch }> = [
  {
    keys: ['放量', '量比', '巨量', '成交量放大'],
    match: {
      label: '扫描：放量突破',
      hint: '量比≥2 · 涨幅 1%~7%',
      presetId: 'volume_breakout',
      extra: { volumeSpikeRatio: 2, minGainPct: 1 },
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
    keys: ['多头', '均线多头', '多头排列'],
    match: {
      label: '扫描：均线多头',
      hint: 'MA5>MA10>MA20',
      presetId: 'pullback_ma',
      extra: { maBullish: true },
    },
  },
  {
    keys: ['新高', '突破新高', '创阶段新高'],
    match: {
      label: '扫描：20 日新高',
      hint: '收盘创近 20 日新高',
      presetId: 'volume_breakout',
      extra: { newHighDays: 20 },
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
    if (rule.keys.some((k) => kw.includes(k.toLowerCase()) || k.toLowerCase().includes(kw) && kw.length >= 2)) {
      return rule.match;
    }
  }
  return null;
}

export const NL_SCAN_HINTS = ['放量', '金叉', '均线多头', '20日新高', '尾盘选股'];
