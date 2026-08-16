/**
 * 回测历史数据加载器（方向5：历史数据加载器）。
 *
 * 把"拉 K 线 → 规整 → 喂给回测引擎"这段流程收敛成可复用、可测试的能力：
 *  - 纯函数 `prepareCandles`：去重 + 升序排序 + 区间裁剪 + 最少 bar 数校验。
 *  - 异步 `loadBacktestCandles`：按 symbol/周期/区间拉取，必要时向前翻页补齐到 startMs，
 *    返回升序蜡烛（回测引擎要求时间递增）。
 *  - 便捷 `runBacktestOnSymbol`：拉数 + 规整 + runBacktest 一气呵成。
 *
 * 不绑定具体网络库：fetcher 默认走 marketData.getKline，可注入以便测试。
 */
import { marketData } from '@/api';
import type { Candle, Symbol, KlinePeriod, AdjustMode } from '@/api';
import { runBacktest, type BacktestResult, type BacktestOptions } from './backtest';
import type { Strategy } from './strategies';

export interface PrepareOptions {
  /** 最少 bar 数（少于则 ok=false）。默认 30。 */
  minBars?: number;
  /** 区间起点（含），ms */
  startMs?: number;
  /** 区间终点（含），ms */
  endMs?: number;
}

export interface PrepareResult {
  candles: Candle[];
  ok: boolean;
  reason?: string;
}

function timeOf(c: Candle): number {
  return new Date(c.datetime).getTime();
}

/**
 * 纯函数：规整 K 线为回测可用形态。
 * - 按时间毫秒去重（同时间戳只保留一条）
 * - 升序排序（回测引擎逐根右移，要求递增）
 * - 按 startMs/endMs 裁剪
 * - 不足 minBars 返回 ok=false + reason
 */
export function prepareCandles(candles: Candle[], opts: PrepareOptions = {}): PrepareResult {
  const minBars = opts.minBars ?? 30;
  if (!candles || candles.length === 0) {
    return { candles: [], ok: false, reason: '无K线数据' };
  }
  const map = new Map<number, Candle>();
  for (const c of candles) {
    const t = timeOf(c);
    if (!Number.isFinite(t)) continue;
    if (!map.has(t)) map.set(t, c);
  }
  let sorted = Array.from(map.values()).sort((a, b) => timeOf(a) - timeOf(b));
  if (opts.startMs !== undefined) sorted = sorted.filter((c) => timeOf(c) >= opts.startMs!);
  if (opts.endMs !== undefined) sorted = sorted.filter((c) => timeOf(c) <= opts.endMs!);
  if (sorted.length < minBars) {
    return { candles: sorted, ok: false, reason: `K线不足（${sorted.length}/需${minBars}）` };
  }
  return { candles: sorted, ok: true };
}

export interface LoadCandlesOptions {
  period?: KlinePeriod;
  /** 单次拉取数量，默认 250 */
  count?: number;
  startMs?: number;
  endMs?: number;
  adjust?: AdjustMode;
  /** 注入 fetcher（测试用），默认 marketData.getKline */
  fetchKline?: (p: {
    symbol: Symbol;
    period: KlinePeriod;
    count?: number;
    startMs?: number;
    endMs?: number;
    adjust?: AdjustMode;
  }) => Promise<Candle[]>;
  /** 向前翻页补齐的最多次数，默认 12（约 12*count 根） */
  maxPages?: number;
}

function dedupePrepend(acc: Candle[], more: Candle[]): Candle[] {
  // more 为更早的页，应放在前面；去重以现有 acc 为主
  const seen = new Set(acc.map(timeOf));
  return [...more.filter((c) => !seen.has(timeOf(c))), ...acc];
}

/**
 * 异步：拉取某标的回测用历史 K 线（升序）。
 * 若指定 startMs，会向前翻页直到最早一根早于 startMs 或达到 maxPages。
 */
export async function loadBacktestCandles(
  symbol: Symbol,
  opts: LoadCandlesOptions = {},
): Promise<Candle[]> {
  const period = opts.period ?? 'day';
  const count = opts.count ?? 250;
  const fetch = opts.fetchKline ?? ((p) => marketData.getKline(p));
  const maxPages = opts.maxPages ?? 12;

  let acc: Candle[] = [];
  let cursorEndMs: number | undefined = opts.endMs;
  for (let page = 0; page < maxPages; page++) {
    const slice = await fetch({ symbol, period, count, startMs: undefined, endMs: cursorEndMs, adjust: opts.adjust });
    if (!slice || slice.length === 0) break;
    acc = dedupePrepend(acc, slice);
    const earliest = acc[0];
    const earliestMs = timeOf(earliest);
    if (opts.startMs !== undefined && earliestMs <= opts.startMs) break;
    // 继续向前翻：以当前最早一根为结束点
    cursorEndMs = earliestMs;
    if (slice.length < count) break; // 已到最早
  }
  // acc 当前是各页（早→晚）拼接后的升序；最终按时间升序返回
  return acc.sort((a, b) => timeOf(a) - timeOf(b));
}

export interface RunBacktestOnSymbolOptions extends LoadCandlesOptions, PrepareOptions, BacktestOptions {}

/**
 * 便捷：拉历史 → 规整 → 跑回测。返回 null 表示数据不足（配置失败）。
 */
export async function runBacktestOnSymbol(
  strategy: Strategy,
  symbol: Symbol,
  opts: RunBacktestOnSymbolOptions = {},
): Promise<BacktestResult | null> {
  const candles = await loadBacktestCandles(symbol, opts);
  const prepared = prepareCandles(candles, { minBars: opts.minBars, startMs: opts.startMs, endMs: opts.endMs });
  if (!prepared.ok) return null;
  return runBacktest(strategy, prepared.candles, opts);
}
