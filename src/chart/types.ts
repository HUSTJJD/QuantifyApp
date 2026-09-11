/**
 * K 线图表域类型（借鉴 kline-charts-react 设计，适配 RN / native-kline-view）。
 */
import type { Candle, Symbol } from '@/data/api';

export type ChartMarket = 'A' | 'HK' | 'US';

/** 图表周期：分时 + 分钟 + 日周月 */
export type ChartPeriod =
  | 'timeline'
  | 'timeline5'
  | '1m'
  | '5m'
  | '15m'
  | '30m'
  | '60m'
  | 'day'
  | 'week'
  | 'month';

export type ChartAdjust = 'none' | 'forward' | 'backward';

export type MainIndicatorId = 'none' | 'ma' | 'boll' | 'sar' | 'kc';
export type SubIndicatorId =
  | 'none'
  | 'volume'
  | 'macd'
  | 'kdj'
  | 'rsi'
  | 'wr'
  | 'bias'
  | 'cci'
  | 'atr'
  | 'obv'
  | 'roc'
  | 'dmi';

export type IndicatorId = MainIndicatorId | SubIndicatorId;

/** 指标算法参数（是否显示由 UI 状态控制） */
export interface IndicatorOptions {
  ma?: { periods?: number[]; type?: 'sma' | 'ema' | 'wma' };
  macd?: { short?: number; long?: number; signal?: number };
  boll?: { period?: number; stdDev?: number };
  kdj?: { period?: number };
  rsi?: { periods?: number[] };
  wr?: { periods?: number[] };
  bias?: { periods?: number[] };
  cci?: { period?: number };
  atr?: { period?: number };
  obv?: { maPeriod?: number };
  roc?: { period?: number; signalPeriod?: number };
  dmi?: { period?: number; adxPeriod?: number };
  sar?: { afStart?: number; afIncrement?: number; afMax?: number };
  kc?: { emaPeriod?: number; atrPeriod?: number; multiplier?: number };
}

/** 数据提供者：可插拔（默认 stock-sdk / 本地库） */
export interface KlineDataProvider {
  /** K 线（升序 Candle）；cursor/limit 供向前翻页 */
  getKline(params: {
    symbol: Symbol;
    market: ChartMarket;
    period: ChartPeriod;
    adjust: ChartAdjust;
    cursor?: number;
    limit?: number;
  }): Promise<Candle[]>;
  /** 分时（可选）；返回序列 + 昨收 */
  getTimeline?(params: {
    symbol: Symbol;
    market: ChartMarket;
    period?: 'timeline' | 'timeline5';
  }): Promise<{ data: Candle[]; prevClose?: number | null }>;
}

export interface AutoRefreshConfig {
  intervalMs?: number;
  /** 仅在对应市场交易时段刷新 */
  onlyTradingTime?: boolean;
}

export function isTimelinePeriod(p: ChartPeriod): boolean {
  return p === 'timeline' || p === 'timeline5';
}

/** ChartPeriod → 行情层 KlinePeriod（分时用 1m） */
export function toKlinePeriod(p: ChartPeriod): import('@/data/api').KlinePeriod {
  switch (p) {
    case 'timeline':
    case 'timeline5':
    case '1m':
      return '1m';
    case '5m':
      return '5m';
    case '15m':
      return '15m';
    case '30m':
      return '30m';
    case '60m':
      return '60m';
    case 'week':
      return 'week';
    case 'month':
      return 'month';
    default:
      return 'day';
  }
}
