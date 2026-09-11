/**
 * 多标的组合层面的绩效合成。
 *
 * 现状说明（重要，避免误读）：
 * 本仓库的单标的回测引擎（`backtest.ts`）是**逐标的独立满仓 In & Out** 模型，
 * 池回测时各标的各跑一遍、互不知道对方存在，因此「池收益」当前只是各标的收益的算术平均，
 * 并不能代表同时持有 N 只标的时的真实资金占用与净值波动。
 *
 * 这里提供一个**务实的中间层**：把各标的的权益曲线按交易日（UTC 日键）对齐，
 * 逐日对各标的收益做等权平均，累乘成一条组合净值曲线,再按同一套指标口径计算收益/回撤/风险指标。
 *
 * 它不是真正的组合回测（没有资金竞争、没有 `maxPositions` 约束、没有逐标的仓位限额），
 * 调用方在 UI / 报告里必须标注为「等权合成」，不要当成组合实盘收益。
 */
import type { Candle } from '@/data/api';
import {
  annualizedReturnPct,
  annualizedVolatilityPct,
  calmarRatio,
  maxDrawdownPct,
  sharpeRatio,
  sortinoRatio,
} from './metrics';

/** 参与合成的单个标的 */
export interface PortfolioLeg {
  /** 标识（一般传 symbol key），用于统计覆盖度与去重 */
  key: string;
  /** 展示名（可选） */
  label?: string;
  /** 该标的回测的权益曲线（与 candles 等长） */
  equity: number[];
  /** 该标的回测用的 K 线（提供日期） */
  candles: Candle[];
}

export interface PortfolioMetrics {
  totalReturnPct: number;
  annualizedReturnPct: number;
  maxDrawdownPct: number;
  volatilityPct: number;
  sharpe: number;
  sortino: number;
  calmar: number;
}

export interface CombinedPortfolio {
  /** 组合净值（基准 100），与 dates 等长 */
  nav: number[];
  /** 净值对应的日键（UTC 日毫秒） */
  dates: number[];
  /** 参与合成的标的数 */
  legCount: number;
  /** 所有标的都有数据的交易日占比（%），越低说明样本区间越不齐 */
  fullOverlapPct: number;
  metrics: PortfolioMetrics;
}

const DAY_MS = 86_400_000;

/** UTC 日键：跨标的统一口径，避免时区导致的错位 */
function dayKey(datetime: number | string): number {
  const t = typeof datetime === 'number' ? datetime : new Date(datetime).getTime();
  if (!Number.isFinite(t)) return NaN;
  return Math.floor(t / DAY_MS) * DAY_MS;
}

/**
 * 等权合成多标的权益曲线。
 *
 * 缺失处理：某交易日某标的无数据时，该日只用有数据的标的做等权平均
 * （不做前向填充，避免用一只票的收益冒充另一只票）。
 */
export function combinePortfolio(
  legs: PortfolioLeg[],
  barsPerYear = 252,
  riskFreeAnnualPct = 0,
): CombinedPortfolio {
  const emptyMetrics: PortfolioMetrics = {
    totalReturnPct: 0,
    annualizedReturnPct: 0,
    maxDrawdownPct: 0,
    volatilityPct: 0,
    sharpe: 0,
    sortino: 0,
    calmar: 0,
  };
  const usable = legs.filter((l) => l.equity.length >= 2 && l.candles.length >= 2);
  // 组合语义要求 ≥2 只标的；单标的组合会与个股详报重复，直接返回空
  if (usable.length < 2) {
    return { nav: [], dates: [], legCount: 0, fullOverlapPct: 0, metrics: emptyMetrics };
  }

  // 每条腿：日键 → 当日收益（相对上一根 bar）
  const perLeg: Map<number, number>[] = usable.map((leg) => {
    const m = new Map<number, number>();
    const n = Math.min(leg.equity.length, leg.candles.length);
    for (let i = 1; i < n; i++) {
      const prev = leg.equity[i - 1];
      const key = dayKey(leg.candles[i].datetime);
      if (!Number.isFinite(key) || !(prev > 0)) continue;
      m.set(key, leg.equity[i] / prev - 1);
    }
    return m;
  });

  const dateSet = new Set<number>();
  for (const m of perLeg) for (const k of m.keys()) dateSet.add(k);
  const dates = [...dateSet].sort((a, b) => a - b);
  if (dates.length === 0) {
    return { nav: [], dates: [], legCount: usable.length, fullOverlapPct: 0, metrics: emptyMetrics };
  }

  const nav: number[] = [100];
  let fullDates = 0;
  for (const d of dates) {
    let sum = 0;
    let count = 0;
    for (const m of perLeg) {
      const r = m.get(d);
      if (r != null) {
        sum += r;
        count++;
      }
    }
    if (count === perLeg.length) fullDates++;
    if (count === 0) continue;
    nav.push(nav[nav.length - 1] * (1 + sum / count));
  }
  // nav 首个 100 之后每天一个点：对齐长度
  const series = nav.slice(1);
  if (series.length === 0) {
    return { nav: [], dates: [], legCount: usable.length, fullOverlapPct: 0, metrics: emptyMetrics };
  }

  const annualized = annualizedReturnPct(series, barsPerYear);
  const maxDd = maxDrawdownPct(series);
  return {
    nav: series,
    dates,
    legCount: usable.length,
    fullOverlapPct: (fullDates / dates.length) * 100,
    metrics: {
      totalReturnPct: (series[series.length - 1] / 100 - 1) * 100,
      annualizedReturnPct: annualized,
      maxDrawdownPct: maxDd,
      volatilityPct: annualizedVolatilityPct(series, barsPerYear),
      sharpe: sharpeRatio(series, barsPerYear, riskFreeAnnualPct),
      sortino: sortinoRatio(series, barsPerYear, riskFreeAnnualPct),
      calmar: calmarRatio(annualized, maxDd),
    },
  };
}
