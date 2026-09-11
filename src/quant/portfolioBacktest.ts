/**
 * 真正的组合回测：共享资金 + 最多同时持有 N 只（maxPositions）+ 资金竞争。
 *
 * 与 `portfolio.ts` 的「等权合成」不同，这里是**资金层面**的组合：
 *  - 各腿提供单标的 `runBacktest` 的 equity 曲线，自动推导「当日策略是否持仓」
 *    （equity 当日不动 = 策略空仓 → 收益 0；当日变动 = 持仓 → 取当日收益）；
 *  - 共享一个资金池，每天把「策略在场」的腿视为期望持仓；
 *  - 若期望持仓数 ≤ maxPositions，全部等权持有；否则按近期动量排序取前 N，
 *    被挤出的腿当日留现金（资金竞争，不再假装同时持有全部）；
 *  - 换仓（进/出）计单边成本，更贴近实盘换手。
 *
 * 这是 backtest-engine-v2 遗留的「真正组合回测」落地项。
 */
import {
  annualizedReturnPct,
  annualizedVolatilityPct,
  calmarRatio,
  DEFAULT_BARS_PER_YEAR,
  maxDrawdownPct,
  sharpeRatio,
  sortinoRatio,
} from './metrics';

export interface PortfolioLegInput {
  key: string;
  /** 单标的 runBacktest 的 equity（与 K 线等长） */
  equity: number[];
}

export interface PortfolioBacktestOptions {
  /** 组合初始资金（默认 1,000,000） */
  initCash?: number;
  /** 最多同时持仓数（默认 = 腿数，即不限制） */
  maxPositions?: number;
  /** 单边换手成本（买/卖各收一次），默认 0.00075 */
  costPct?: number;
  /** 资金竞争排名回望窗口（日），默认 5 */
  rankLookback?: number;
  /** 年化 bar 数，默认 252 */
  barsPerYear?: number;
}

export interface PortfolioBacktestResult {
  /** 组合净值（绝对资金，首点 = initCash） */
  nav: number[];
  legCount: number;
  maxPositions: number;
  metrics: {
    totalReturnPct: number;
    annualizedReturnPct: number;
    maxDrawdownPct: number;
    volatilityPct: number;
    sharpe: number;
    sortino: number;
    calmar: number;
  };
  /** 日均持仓数 */
  avgPositions: number;
  /** 因期望持仓 > maxPositions 被迫跳过的交易日占比（%） */
  skippedDaysPct: number;
  /** 有持仓的交易日占比（%） */
  exposurePct: number;
}

const EMPTY_METRICS = {
  totalReturnPct: 0,
  annualizedReturnPct: 0,
  maxDrawdownPct: 0,
  volatilityPct: 0,
  sharpe: 0,
  sortino: 0,
  calmar: 0,
};

/** 腿 k 在截至当日（含）的近 lookback 日平均收益，用于资金竞争排名 */
function momentum(returns: number[][], k: number, dayIdx0: number, lookback: number): number {
  const r = returns[k];
  if (!r || r.length === 0) return 0;
  const end = dayIdx0; // 当日收益在 returns 中的 0-based 下标
  const start = Math.max(0, end - lookback + 1);
  let sum = 0;
  let cnt = 0;
  for (let i = start; i <= end; i++) {
    sum += r[i] ?? 0;
    cnt += 1;
  }
  return cnt > 0 ? sum / cnt : 0;
}

export function runPortfolioBacktest(
  legs: PortfolioLegInput[],
  opts: PortfolioBacktestOptions = {},
): PortfolioBacktestResult {
  const initCash = opts.initCash ?? 1_000_000;
  const maxPositions = Math.max(1, opts.maxPositions ?? Math.max(1, legs.length));
  const costPct = opts.costPct ?? 0.00075;
  const rankLookback = Math.max(1, opts.rankLookback ?? 5);
  const barsPerYear = opts.barsPerYear ?? DEFAULT_BARS_PER_YEAR;

  // 预计算每腿每日收益（与 equity 等长，首点为 0）
  const returns = legs.map((l) => {
    const r: number[] = [];
    for (let i = 1; i < l.equity.length; i++) {
      const prev = l.equity[i - 1];
      r.push(prev > 0 ? l.equity[i] / prev - 1 : 0);
    }
    return r;
  });

  const minLen = legs.reduce((m, l) => Math.min(m, l.equity.length), Infinity);
  const days = Number.isFinite(minLen) ? Math.max(0, minLen - 1) : 0;

  if (legs.length < 1 || days < 1) {
    return {
      nav: [initCash],
      legCount: legs.length,
      maxPositions,
      metrics: EMPTY_METRICS,
      avgPositions: 0,
      skippedDaysPct: 0,
      exposurePct: 0,
    };
  }

  let cash = initCash;
  const positions = new Map<number, number>(); // 腿下标 → 当前市值
  let prevHeld = new Set<number>();

  const nav: number[] = [initCash];
  let heldSum = 0;
  let skippedDays = 0;
  let exposureDays = 0;

  for (let d = 1; d <= days; d++) {
    const dayIdx0 = d - 1;
    // 当日「策略在场」的腿（收益非 0）
    const desired: number[] = [];
    for (let k = 0; k < legs.length; k++) {
      const ret = dayIdx0 < returns[k].length ? returns[k][dayIdx0] : 0;
      if (Math.abs(ret) > 1e-12) desired.push(k);
    }

    // 资金竞争：超出 maxPositions 按近期动量取前 N
    let held = desired;
    if (desired.length > maxPositions) {
      skippedDays += 1;
      held = desired
        .slice()
        .sort(
          (a, b) =>
            momentum(returns, b, dayIdx0, rankLookback) - momentum(returns, a, dayIdx0, rankLookback),
        )
        .slice(0, maxPositions);
    }
    const heldSet = new Set(held);

    // 退出者：平仓并计卖出成本
    for (const k of prevHeld) {
      if (!heldSet.has(k)) {
        const v = positions.get(k) ?? 0;
        cash += v * (1 - costPct);
        positions.delete(k);
      }
    }
    // 新进者：现金等额分摊，计买入成本
    const added = held.filter((k) => !prevHeld.has(k));
    if (added.length > 0) {
      const alloc = cash / added.length;
      for (const k of added) {
        const deploy = alloc * (1 - costPct);
        cash -= alloc;
        positions.set(k, deploy);
      }
    }
    // 持仓市值按当日收益增长
    for (const k of heldSet) {
      const v = positions.get(k) ?? 0;
      const ret = dayIdx0 < returns[k].length ? returns[k][dayIdx0] : 0;
      positions.set(k, v * (1 + ret));
    }

    let total = cash;
    for (const v of positions.values()) total += v;
    nav.push(total);

    heldSum += heldSet.size;
    if (heldSet.size > 0) exposureDays += 1;
    prevHeld = heldSet;
  }

  const totalRet = (nav[nav.length - 1] / initCash - 1) * 100;
  const maxDd = maxDrawdownPct(nav);
  const ann = annualizedReturnPct(nav, barsPerYear);
  return {
    nav,
    legCount: legs.length,
    maxPositions,
    metrics: {
      totalReturnPct: totalRet,
      annualizedReturnPct: ann,
      maxDrawdownPct: maxDd,
      volatilityPct: annualizedVolatilityPct(nav, barsPerYear),
      sharpe: sharpeRatio(nav, barsPerYear),
      sortino: sortinoRatio(nav, barsPerYear),
      calmar: calmarRatio(ann, maxDd),
    },
    avgPositions: days > 0 ? heldSum / days : 0,
    skippedDaysPct: days > 0 ? (skippedDays / days) * 100 : 0,
    exposurePct: days > 0 ? (exposureDays / days) * 100 : 0,
  };
}
