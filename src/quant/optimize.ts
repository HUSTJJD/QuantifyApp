/**
 * 参数优化（方向5：网格/遍历找最优参数）。
 *
 * 给定策略工厂 + 参数网格，对每种参数组合跑回测，按指定绩效指标排序，
 * 返回最优参数与对应回测结果。纯函数为主，便于单测。
 *
 * 注意：参数优化只在历史数据上有效，存在过拟合风险；本模块仅做"遍历+排序"，
 * 不含样本外验证，业务层应自行做 walk-forward / 区间外校验。
 */
import type { Candle } from '@/api';
import { runBacktest, type BacktestResult, type BacktestOptions } from './backtest';
import type { Strategy } from './strategies';

/** 参数网格：每个键对应一组候选取值。 */
export type ParamGrid = Record<string, number[]>;

/** 一组具体参数（键=参数名，值=数值）。 */
export type ParamCombo = Record<string, number>;

/** 评分指标：从回测结果取一个标量用于排序。 */
export type ScoreMetric = 'totalReturnPct' | 'sharpe' | 'winRate' | 'finalEquity';

export interface OptimizeOptions extends BacktestOptions {
  metric?: ScoreMetric;
  /** 是否取指标最大（默认 true；false 则取最小，如最大回撤） */
  maximize?: boolean;
  /** 仅保留前 N 名（默认全部） */
  topN?: number;
}

export interface OptimizeEntry {
  params: ParamCombo;
  result: BacktestResult;
  score: number;
}

/** 展开参数网格为所有组合（笛卡尔积）。 */
export function expandGrid(grid: ParamGrid): ParamCombo[] {
  const keys = Object.keys(grid);
  if (keys.length === 0) return [{}];
  let combos: ParamCombo[] = [{}];
  for (const k of keys) {
    const vals = grid[k];
    const next: ParamCombo[] = [];
    for (const base of combos) {
      for (const v of vals) next.push({ ...base, [k]: v });
    }
    combos = next;
  }
  return combos;
}

/** 从回测结果取评分标量。 */
export function scoreOf(result: BacktestResult, metric: ScoreMetric): number {
  switch (metric) {
    case 'totalReturnPct':
      return result.totalReturnPct;
    case 'sharpe':
      return result.sharpe;
    case 'winRate':
      return result.winRate;
    case 'finalEquity':
      return result.finalEquity;
  }
}

/**
 * 网格搜索最优参数。
 * @param makeStrategy 由一组参数构造 Strategy（例如把 param 注入 evaluate 的 context）。
 * @param candles 历史 K 线（升序）
 * @param grid 参数网格
 */
export function gridSearch(
  makeStrategy: (params: ParamCombo) => Strategy,
  candles: Candle[],
  grid: ParamGrid,
  opts: OptimizeOptions = {},
): OptimizeEntry[] {
  const metric = opts.metric ?? 'totalReturnPct';
  const maximize = opts.maximize ?? true;
  const combos = expandGrid(grid);
  const entries: OptimizeEntry[] = [];
  for (const params of combos) {
    const strategy = makeStrategy(params);
    const result = runBacktest(strategy, candles, opts);
    entries.push({ params, result, score: scoreOf(result, metric) });
  }
  entries.sort((a, b) => (maximize ? b.score - a.score : a.score - b.score));
  return opts.topN ? entries.slice(0, opts.topN) : entries;
}

/** 取最优一组（无组合返回 null）。 */
export function bestParams(
  makeStrategy: (params: ParamCombo) => Strategy,
  candles: Candle[],
  grid: ParamGrid,
  opts: OptimizeOptions = {},
): OptimizeEntry | null {
  const all = gridSearch(makeStrategy, candles, grid, opts);
  return all[0] ?? null;
}
