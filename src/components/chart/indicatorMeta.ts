/**
 * 指标元信息单一数据源：主图 / 副图分组 + 中文标签。
 * 选择器、副图标题、面板布局统一从这里取。
 */
import type { IndicatorId, MainIndicatorId, SubIndicatorId } from './types';

export type IndicatorGroup = 'main' | 'sub';

export interface IndicatorMeta {
  value: IndicatorId;
  label: string;
  group: IndicatorGroup;
}

export const INDICATOR_META: IndicatorMeta[] = [
  { value: 'ma', label: 'MA', group: 'main' },
  { value: 'boll', label: 'BOLL', group: 'main' },
  { value: 'sar', label: 'SAR', group: 'main' },
  { value: 'kc', label: 'KC', group: 'main' },
  { value: 'volume', label: '成交量', group: 'sub' },
  { value: 'macd', label: 'MACD', group: 'sub' },
  { value: 'kdj', label: 'KDJ', group: 'sub' },
  { value: 'rsi', label: 'RSI', group: 'sub' },
  { value: 'wr', label: 'WR', group: 'sub' },
  { value: 'bias', label: 'BIAS', group: 'sub' },
  { value: 'cci', label: 'CCI', group: 'sub' },
  { value: 'atr', label: 'ATR', group: 'sub' },
  { value: 'obv', label: 'OBV', group: 'sub' },
  { value: 'roc', label: 'ROC', group: 'sub' },
  { value: 'dmi', label: 'DMI', group: 'sub' },
];

export const INDICATOR_LABELS = Object.fromEntries(
  INDICATOR_META.map((m) => [m.value, m.label]),
) as Record<IndicatorId, string>;

export const MAIN_INDICATOR_METAS = INDICATOR_META.filter((m) => m.group === 'main');
export const SUB_INDICATOR_METAS = INDICATOR_META.filter((m) => m.group === 'sub');

const MAIN_SET = new Set<string>(MAIN_INDICATOR_METAS.map((m) => m.value));

export function getIndicatorGroup(id: IndicatorId): IndicatorGroup {
  return MAIN_SET.has(id) ? 'main' : 'sub';
}

export function isMainIndicator(id: IndicatorId): id is MainIndicatorId {
  return getIndicatorGroup(id) === 'main';
}

export function isSubIndicator(id: IndicatorId): id is SubIndicatorId {
  return getIndicatorGroup(id) === 'sub';
}

/** native-kline-view 主图编码（none/ma/boll 先兼容；sar/kc 暂回退 none） */
export function toNativeMainCode(id: MainIndicatorId): number {
  switch (id) {
    case 'ma':
      return 1;
    case 'boll':
      return 2;
    default:
      return 0;
  }
}

/** native-kline-view 副图编码 */
export function toNativeSubCode(id: SubIndicatorId): number {
  switch (id) {
    case 'macd':
      return 3;
    case 'kdj':
      return 4;
    case 'rsi':
      return 5;
    case 'wr':
      return 6;
    default:
      return 0;
  }
}

export function getMAPeriods(periods?: number[]): number[] {
  const cleaned = (periods ?? []).filter((p) => Number.isFinite(p) && p > 0).map(Math.floor);
  return cleaned.length > 0 ? Array.from(new Set(cleaned)).sort((a, b) => a - b) : [5, 10, 20, 30, 60];
}
