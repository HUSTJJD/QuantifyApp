/**
 * 本地 K 线读取服务：基于 SQLite 本地库（不复权日 K + 复权因子）生成展示数据。
 *
 * 能力（用户确认的复权体系）：
 *  - getCandlesLocal(symbol, period, adjust)：
 *      1. 读本地日 K（不复权）；
 *      2. period 为 week/month 时本地聚合（aggregateByPeriod）；
 *      3. 按 adjust 模式（none/forward/backward）本地复权计算；
 *  - getAdjustFactorsLocal(symbol)：读本地复权因子（供 UI/指标复用）。
 *
 * 说明：若本地无日 K（未同步过），回退到行情源实时拉取（一次性使用，不落库，
 * 由 useKline 负责落库路径）。本服务面向「全市场扫描 / 设置页统计」等批量场景。
 */
import { marketData } from '@/api';
import { database } from './index';
import { MarketMetaStore } from './MarketMetaStore';
import { aggregateByPeriod } from '@/quant/aggregate';
import { adjustCandles } from '@/quant/adjustment';
import type { AdjustmentFactorInput } from '@/quant/adjustment';
import type { Candle, KlinePeriod, Symbol } from '@/api';

/** 本地复权因子 -> 复权计算输入 */
function toFactorInputs(symbol: Symbol, factors: { exDateMs: number; dividendPerShare: number | null; perShareBonus: number | null; allotmentRatio: number | null; allotmentPrice: number | null }[]): AdjustmentFactorInput[] {
  return factors.map((f) => ({
    exDateMs: f.exDateMs,
    dividendPerShare: f.dividendPerShare,
    perShareBonus: f.perShareBonus,
    allotmentRatio: f.allotmentRatio,
    allotmentPrice: f.allotmentPrice,
  }));
}

/**
 * 从本地库读取某标的 K 线（可按周期聚合 + 复权）。
 * 本地无数据时返回 null（调用方决定是否回退网络）。
 */
export async function getCandlesLocal(
  symbol: Symbol,
  period: KlinePeriod,
  adjust: 'none' | 'forward' | 'backward' = 'none',
): Promise<Candle[] | null> {
  const db = database();
  // 本地只存日 K（不复权）；周/月由日 K 聚合
  const daily = await db.getCandles(symbol, 'day');
  if (!daily || daily.length === 0) return null;

  const base = aggregateByPeriod(daily, period);

  if (adjust === 'none') return base;

  const store = new MarketMetaStore();
  const sk = `${symbol.exchange}.${symbol.code}`;
  const factors = await store.getFactors(sk);
  if (factors.length === 0) return base;

  return adjustCandles(base, toFactorInputs(symbol, factors), adjust);
}

/** 读本地复权因子（无则返回空数组） */
export async function getAdjustFactorsLocal(symbol: Symbol): Promise<AdjustmentFactorInput[]> {
  const store = new MarketMetaStore();
  const sk = `${symbol.exchange}.${symbol.code}`;
  const factors = await store.getFactors(sk);
  return toFactorInputs(symbol, factors);
}

/** 回退网络拉取（本地无数据时的一次性兜底；不落库） */
export async function getCandlesFallback(
  symbol: Symbol,
  period: KlinePeriod,
  adjust: 'none' | 'forward' | 'backward' = 'none',
  count = 300,
): Promise<Candle[]> {
  const raw = await marketData.getKline({ symbol, period, count, adjust });
  if (adjust === 'none' || !raw || raw.length === 0) return raw;
  // 网络返回的复权价不落库（库只存不复权）；这里直接返回源复权结果即可
  return raw;
}
