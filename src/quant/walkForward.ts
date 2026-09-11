/**
 * 样本外验证：训练/验证区间划分 + 内外指标对比。
 *
 * 目的：回测若只看单一区间，容易过拟合。把 K 线切成「训练集 + 验证集」，
 * 分别跑回测后对比指标——若样本外收益/夏普大幅衰减，说明策略可能过拟合。
 *
 * 纯函数，不依赖 UI / 网络 / 存储。
 */
import type { Candle } from '@/data/api';
import { runBacktest, type BacktestResult, type BacktestOptions } from './backtest';
import type { Strategy } from './strategies';

export interface SplitOptions {
  /** 训练集占比（0~1），默认 0.7 */
  trainRatio?: number;
  /** 最少训练 bar 数，默认 30 */
  minTrainBars?: number;
  /** 最少验证 bar 数，默认 10 */
  minValBars?: number;
}

export interface SplitResult {
  train: Candle[];
  val: Candle[];
  ok: boolean;
  reason?: string;
}

/**
 * 把 K 线切成训练集 + 验证集（按时间顺序，前 trainRatio 为训练）。
 */
export function splitCandles(candles: Candle[], opts: SplitOptions = {}): SplitResult {
  const trainRatio = opts.trainRatio ?? 0.7;
  const minTrain = opts.minTrainBars ?? 30;
  const minVal = opts.minValBars ?? 10;
  const n = candles.length;

  if (n < minTrain + minVal) {
    return { train: [], val: [], ok: false, reason: `K线不足（${n}/需${minTrain + minVal}）` };
  }

  const splitIdx = Math.floor(n * trainRatio);
  if (splitIdx < minTrain) {
    return { train: [], val: [], ok: false, reason: `训练集不足（${splitIdx}/需${minTrain}）` };
  }
  if (n - splitIdx < minVal) {
    return { train: [], val: [], ok: false, reason: `验证集不足（${n - splitIdx}/需${minVal}）` };
  }

  return {
    train: candles.slice(0, splitIdx),
    val: candles.slice(splitIdx),
    ok: true,
  };
}

export interface WalkForwardResult {
  train: BacktestResult;
  val: BacktestResult;
  /** 收益衰减率（%）：(train - val) / |train|；train 为 0 时为 0 */
  returnDecayPct: number;
  /** 夏普衰减率（%）：(train - val) / |train|；train 为 0 时为 0 */
  sharpeDecayPct: number;
  /** 是否疑似过拟合：验证集收益为负且训练集为正，或夏普衰减 > 50% */
  likelyOverfit: boolean;
}

/**
 * Walk-forward 验证：同一策略在训练集和验证集上分别回测，对比指标。
 * @param strategy 策略
 * @param candles 完整 K 线（升序）
 * @param opts 区间划分 + 回测选项
 */
export function walkForward(
  strategy: Strategy,
  candles: Candle[],
  opts: BacktestOptions & SplitOptions = {},
): WalkForwardResult | null {
  const split = splitCandles(candles, opts);
  if (!split.ok) return null;

  const train = runBacktest(strategy, split.train, opts);
  const val = runBacktest(strategy, split.val, opts);

  const returnDecayPct =
    train.totalReturnPct !== 0
      ? ((train.totalReturnPct - val.totalReturnPct) / Math.abs(train.totalReturnPct)) * 100
      : 0;
  const sharpeDecayPct =
    train.sharpe !== 0 ? ((train.sharpe - val.sharpe) / Math.abs(train.sharpe)) * 100 : 0;

  // 过拟合判定：验证集亏损且训练集盈利，或夏普衰减超过一半
  const likelyOverfit =
    (train.totalReturnPct > 0 && val.totalReturnPct < 0) || sharpeDecayPct > 50;

  return {
    train,
    val,
    returnDecayPct,
    sharpeDecayPct,
    likelyOverfit,
  };
}
