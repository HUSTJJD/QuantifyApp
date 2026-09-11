/**
 * 基准对比：把策略回测结果与基准指数（如沪深300）对齐比较。
 *
 * 纯函数，不依赖 UI / 网络：
 *  - `alignByDate`：把策略权益与基准收盘价按日期对齐
 *  - `computeBenchmarkMetrics`：超额收益、跟踪误差、信息比率
 *
 * 基准 K 线由调用方拉取后传入（走 marketData.getKline）。
 */
import type { Candle } from '@/data/api';

export interface AlignedPoint {
  date: number;
  /** 策略权益（归一化到 100） */
  strategyNav: number;
  /** 基准收盘价（归一化到 100） */
  benchmarkNav: number;
}

/**
 * 按日期对齐策略权益与基准 K 线。
 * @param strategyEquity 策略权益曲线（与 strategyCandles 等长）
 * @param strategyCandles 策略回测用 K 线（提供日期）
 * @param benchmarkCandles 基准 K 线
 */
export function alignByDate(
  strategyEquity: number[],
  strategyCandles: Candle[],
  benchmarkCandles: Candle[],
): AlignedPoint[] {
  if (strategyEquity.length === 0 || benchmarkCandles.length === 0) return [];

  // 基准按日期建索引
  const benchMap = new Map<number, number>();
  for (const c of benchmarkCandles) {
    const t = new Date(c.datetime).getTime();
    if (Number.isFinite(t)) benchMap.set(t, c.close);
  }

  // 策略首日权益 / 基准首日收盘 作为归一化基准
  const strategyBase = strategyEquity[0];
  const firstBench = strategyCandles
    .map((c) => benchMap.get(new Date(c.datetime).getTime()))
    .find((v) => v != null && v > 0);
  if (!strategyBase || !firstBench) return [];

  const points: AlignedPoint[] = [];
  for (let i = 0; i < strategyEquity.length && i < strategyCandles.length; i++) {
    const t = new Date(strategyCandles[i].datetime).getTime();
    const bench = benchMap.get(t);
    if (bench == null || bench <= 0) continue; // 基准无数据的日期跳过
    points.push({
      date: t,
      strategyNav: (strategyEquity[i] / strategyBase) * 100,
      benchmarkNav: (bench / firstBench) * 100,
    });
  }
  return points;
}

export interface BenchmarkMetrics {
  /** 策略区间收益（%） */
  strategyReturnPct: number;
  /** 基准区间收益（%） */
  benchmarkReturnPct: number;
  /** 超额收益 = 策略 - 基准（%） */
  excessReturnPct: number;
  /** 年化超额收益（%） */
  annualizedExcessPct: number;
  /** 跟踪误差（年化，%）：超额收益波动 × √barsPerYear */
  trackingErrorPct: number;
  /** 信息比率：年化超额 / 跟踪误差 */
  informationRatio: number;
  /** Beta：策略对基准的敏感度（Cov(s,b)/Var(b)） */
  beta: number;
  /** Jensen Alpha（年化，%）：策略收益中无法被 Beta 解释的部分 */
  alphaAnnualPct: number;
  /** 与基准收益的相关系数（-1 ~ 1） */
  correlation: number;
}

/**
 * 计算基准对比指标。
 * @param points 对齐后的净值序列（升序）
 * @param barsPerYear 年化折算因子（日 K = 252；非日 K 必须传入，否则年化失真）
 */
export function computeBenchmarkMetrics(points: AlignedPoint[], barsPerYear = 252): BenchmarkMetrics {
  const empty: BenchmarkMetrics = {
    strategyReturnPct: 0,
    benchmarkReturnPct: 0,
    excessReturnPct: 0,
    annualizedExcessPct: 0,
    trackingErrorPct: 0,
    informationRatio: 0,
    beta: 0,
    alphaAnnualPct: 0,
    correlation: 0,
  };
  if (points.length < 2) return empty;

  const first = points[0];
  const last = points[points.length - 1];
  const strategyReturnPct = ((last.strategyNav - first.strategyNav) / first.strategyNav) * 100;
  const benchmarkReturnPct = ((last.benchmarkNav - first.benchmarkNav) / first.benchmarkNav) * 100;
  const excessReturnPct = strategyReturnPct - benchmarkReturnPct;

  // 逐期收益 + 超额收益
  const sRets: number[] = [];
  const bRets: number[] = [];
  const excessRets: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const sRet = (points[i].strategyNav - points[i - 1].strategyNav) / points[i - 1].strategyNav;
    const bRet = (points[i].benchmarkNav - points[i - 1].benchmarkNav) / points[i - 1].benchmarkNav;
    sRets.push(sRet);
    bRets.push(bRet);
    excessRets.push(sRet - bRet);
  }
  const pyr = barsPerYear > 0 ? barsPerYear : 252;

  const mean = excessRets.reduce((s, r) => s + r, 0) / excessRets.length;
  const variance = excessRets.reduce((s, r) => s + (r - mean) ** 2, 0) / excessRets.length;
  const trackingErrorPct = Math.sqrt(variance) * Math.sqrt(pyr) * 100;
  const annualizedExcessPct = mean * pyr * 100;
  const informationRatio = trackingErrorPct > 0 ? annualizedExcessPct / trackingErrorPct : 0;

  // Beta / 相关系数：线性回归 sRet = alpha + beta * bRet
  const sMean = sRets.reduce((s, r) => s + r, 0) / sRets.length;
  const bMean = bRets.reduce((s, r) => s + r, 0) / bRets.length;
  let cov = 0;
  let varB = 0;
  let varS = 0;
  for (let k = 0; k < sRets.length; k++) {
    const ds = sRets[k] - sMean;
    const db = bRets[k] - bMean;
    cov += ds * db;
    varB += db * db;
    varS += ds * ds;
  }
  const beta = varB > 0 ? cov / varB : 0;
  const correlation = varB > 0 && varS > 0 ? cov / Math.sqrt(varB * varS) : 0;
  // Jensen Alpha：逐期 α 年化
  const alphaAnnualPct = (sMean - beta * bMean) * pyr * 100;

  return {
    strategyReturnPct,
    benchmarkReturnPct,
    excessReturnPct,
    annualizedExcessPct,
    trackingErrorPct,
    informationRatio,
    beta,
    alphaAnnualPct,
    correlation,
  };
}
