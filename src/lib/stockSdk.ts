/**
 * lib/stockSdk —— 纯计算能力工具层（非网络 API）。
 *
 * stock-sdk v2 把「纯函数、零网络」的能力（指标 / 信号 / 符号解析 / 选股回测）
 * 通过 subpath 独立导出，按需引入、对 tree-shaking 友好。这里把它们统一收口为
 * 一个 facade，供业务层 / 策略 / 计算场景直接 import 使用，无需 StockSDK 实例。
 *
 *   import { calcMACD, computeIndicators, normalizeSymbol, screen, backtest } from '@/lib/stockSdk'
 *
 * 约定：
 *  - 符号 string 是一等公民（'sh600519' / '600519' / '00700' / 'AAPL'），由 normalizeSymbol 容错解析；
 *  - computeIndicators / computeSignals 接收业务层 Candle[]（见 @/api/types），先归一化为 SDK 的 Kline 结构；
 *  - 需要对象 hint 时，请先使用本模块的 normalizeSymbol。
 */
import {
  calcMA,
  calcMACD,
  calcBOLL,
  calcKDJ,
  calcRSI,
  calcWR,
  calcBIAS,
  calcCCI,
  calcATR,
  calcOBV,
  calcROC,
  calcDMI,
  calcSAR,
  calcKC,
  addIndicators,
  type IndicatorOptions,
  type IndicatorKey,
} from 'stock-sdk/indicators';
import { calcSignals, type SignalOptions } from 'stock-sdk/signals';
import { normalizeSymbol, type SymbolRef } from 'stock-sdk/symbols';
import { screen, backtest, type ScreenerChain, type BacktestResult } from 'stock-sdk/screener';

export type { IndicatorOptions, IndicatorKey, SignalOptions, SymbolRef, ScreenerChain, BacktestResult };

/** 重新导出所有指标 / 信号 / 符号原语，方便在别处直接引用 */
export {
  // 指标
  calcMA,
  calcMACD,
  calcBOLL,
  calcKDJ,
  calcRSI,
  calcWR,
  calcBIAS,
  calcCCI,
  calcATR,
  calcOBV,
  calcROC,
  calcDMI,
  calcSAR,
  calcKC,
  addIndicators,
  // 信号
  calcSignals,
  // 符号
  normalizeSymbol,
  // 选股 / 回测
  screen,
  backtest,
};

import type { Candle } from '@/api/types';

/**
 * 业务层 Candle 归一化为 stock-sdk 的 HistoryKline 输入结构。
 * addIndicators 要求 kline 至少包含 date / timestamp / tz / code /
 * open / close / high / low / volume / amount，否则会跳过指标计算。
 */
function toSdkKline(candles: Candle[]): any[] {
  return candles.map((c) => {
    const ts = c.timestamp;
    const d = new Date(ts);
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const exchange = c.symbol?.exchange ?? 'SH';
    const tz = exchange === 'HK' ? 'Asia/Hong_Kong' : exchange === 'US' ? 'America/New_York' : 'Asia/Shanghai';
    return {
      date,
      timestamp: ts,
      tz,
      code: c.symbol?.code ?? '',
      open: c.open,
      close: c.close,
      high: c.high,
      low: c.low,
      volume: c.volume,
      amount: c.amount,
    };
  });
}

/**
 * 给一组 K 线批量追加技术指标（推荐：一次计算多个指标）。
 * @param candles  业务层 K 线（Candle[]）
 * @param options  指标配置对象（key 为小写，如 { ma: { periods: [5, 10] }, macd: {}, boll: {} }）
 *                 等价于 stock-sdk 的 addIndicators(klines, options)
 * @returns        追加了指标字段的 K 线数组（SDK Kline 结构）
 */
export function computeIndicators(candles: Candle[], options: IndicatorOptions): any[] {
  return addIndicators(toSdkKline(candles), options);
}

/**
 * 便捷方法：仅传入小写指标名数组即可计算（默认参数）。
 * @param candles  业务层 K 线
 * @param keys     指标名（小写），如 ['ma','macd','boll','kdj','rsi']
 * @returns        追加了指标字段的 K 线数组
 */
export function computeIndicatorsByKeys(candles: Candle[], keys: IndicatorKey[]): any[] {
  const options = keys.reduce((acc, k) => {
    (acc as any)[k] = true;
    return acc;
  }, {} as IndicatorOptions);
  return addIndicators(toSdkKline(candles), options);
}

/**
 * 在已有 K 线上识别交易信号（金叉 / 死叉 / 超买 / 超卖等）。
 * @param candles  业务层 K 线
 * @param options  指标参数（如 MACD 的 short/long/signal），可选
 */
export function computeSignals(candles: Candle[], options?: SignalOptions): any[] {
  return calcSignals(toSdkKline(candles), options);
}

/**
 * 符号容错解析：返回标准化后的 SymbolRef。
 * 业务层统一用这个做 symbol 入参前的 hint 处理。
 */
export function parseSymbol(input: string): SymbolRef {
  return normalizeSymbol(input);
}
