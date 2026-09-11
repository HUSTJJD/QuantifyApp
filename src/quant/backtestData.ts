/**
 * 回测历史数据加载器（可信取数链路）。
 *
 * 架构原则（与 openspec backtest-trust 一致）：
 *  - **禁止用上游「已复权价」直接回测**。网络请求一律 `adjust: 'none'`。
 *  - 复权 = 本地「不复权 K 线 + 复权因子」合成（`adjustCandles`），默认前复权以得到连续序列。
 *  - 优先本地库（`getCandlesLocal`），本地无日K时再走网络兜底（仍取不复权）。
 *
 * 能力：
 *  - `prepareCandles`：去重 + 升序 + 区间裁剪 + 最少 bar 校验
 *  - `loadBacktestCandles`：只取不复权升序蜡烛
 *  - `loadBacktestSeries`：不复权 + 本地因子合成，返回可回测序列与来源元数据
 *  - `runBacktestOnSymbol`：取数 + 规整 + 复权 + runBacktest
 */
import { marketData } from '@/data/api';
import type { Candle, Symbol, KlinePeriod, AdjustMode } from '@/data/api';
import { runBacktest, type BacktestResult, type BacktestOptions } from './backtest';
import type { Strategy } from './strategies';
import { adjustCandles, type AdjustmentFactorInput } from './adjustment';
import { getCandlesLocal, getAdjustFactorsLocal } from '@/data/db/KlineReader';

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
  /**
   * @deprecated 网络取数强制不复权。保留字段仅为兼容旧调用方；
   * 复权请走 `loadBacktestSeries`（本地因子合成）。
   */
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
 * 异步：拉取某标的回测用**不复权**历史 K 线（升序）。
 * 无论 opts.adjust 传什么，网络层一律 `adjust: 'none'`——已复权价禁止直接进回测。
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
    const slice = await fetch({
      symbol,
      period,
      count,
      startMs: undefined,
      endMs: cursorEndMs,
      // 可信链路：永远取不复权，复权在本地合成
      adjust: 'none',
    });
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

export interface BacktestSeries {
  /** 用于回测的 K 线（已按 adjust 合成；默认前复权连续序列） */
  candles: Candle[];
  /** 实际使用的复权模式 */
  adjustMode: AdjustMode;
  /** 是否使用了本地复权因子 */
  usedLocalFactors: boolean;
  /** 原始不复权序列（便于对照 / 成交价换算） */
  raw: Candle[];
  /** 原始K线来源 */
  source: 'local' | 'network';
  /** 参与合成的因子事件数 */
  factorCount: number;
  /** 本地复权因子原样（供 raw-events 公司行为回放） */
  factors: AdjustmentFactorInput[];
  /** 人可读说明（UI 提示） */
  note: string;
}

export interface LoadBacktestSeriesOptions extends LoadCandlesOptions {
  /**
   * 复权模式：
   * - forward（默认）：本地因子合成前复权连续序列
   * - backward：后复权
   * - none：不复权原样
   * - raw-events：返回不复权 + factors，由 runBacktest 按除权日调仓（推荐严格回放）
   */
  adjustMode?: AdjustMode | 'raw-events';
  /** 注入本地读数（测试用） */
  loadLocal?: (symbol: Symbol, period: KlinePeriod) => Promise<Candle[] | null>;
  loadFactors?: (symbol: Symbol) => Promise<AdjustmentFactorInput[]>;
}

/**
 * 可信取数：不复权 K 线 + 本地复权因子 → 合成可回测序列。
 * 本地无日K时回退网络（仍不复权）；无因子时序列=不复权原样。
 */
export async function loadBacktestSeries(
  symbol: Symbol,
  opts: LoadBacktestSeriesOptions = {},
): Promise<BacktestSeries> {
  const period = opts.period ?? 'day';
  const mode = opts.adjustMode ?? 'forward';
  const adjustMode: AdjustMode = mode === 'raw-events' ? 'none' : mode;
  const loadLocal = opts.loadLocal ?? ((s, p) => getCandlesLocal(s, p, 'none'));
  const loadFactors = opts.loadFactors ?? ((s) => getAdjustFactorsLocal(s));

  let raw: Candle[] = [];
  let source: 'local' | 'network' = 'local';
  try {
    const local = await loadLocal(symbol, period);
    if (local && local.length > 0) {
      raw = local;
    } else {
      source = 'network';
      raw = await loadBacktestCandles(symbol, opts);
    }
  } catch {
    source = 'network';
    raw = await loadBacktestCandles(symbol, opts);
  }

  // 分钟级/指数无因子时 loadFactors 可能抛错——视为 0 因子
  let factors: AdjustmentFactorInput[] = [];
  try {
    factors = (await loadFactors(symbol)) ?? [];
  } catch {
    factors = [];
  }

  // 区间裁剪（在复权前裁，保证系数与 bar 对齐）
  const preparedRaw = prepareCandles(raw, {
    minBars: 0,
    startMs: opts.startMs,
    endMs: opts.endMs,
  });
  const base = preparedRaw.candles;

  // raw-events：序列保持不复权，因子交给回放引擎
  const isRawEvents = mode === 'raw-events';
  const candles =
    isRawEvents || adjustMode === 'none' || factors.length === 0
      ? base
      : adjustCandles(base, factors, adjustMode);

  const usedLocalFactors = !isRawEvents && adjustMode !== 'none' && factors.length > 0;
  const modeLabel = isRawEvents
    ? '不复权+除权事件'
    : adjustMode === 'forward'
      ? '前复权'
      : adjustMode === 'backward'
        ? '后复权'
        : '不复权';
  const note = isRawEvents
    ? factors.length > 0
      ? `${modeLabel}（本地因子 ×${factors.length}，除权日调现金/股数；源：${source === 'local' ? '本地库' : '网络'}）`
      : `${modeLabel}（无本地因子，等同不复权；源：${source === 'local' ? '本地库' : '网络'}）`
    : usedLocalFactors
      ? `${modeLabel}（本地因子 ×${factors.length}，不复权源：${source === 'local' ? '本地库' : '网络'}）`
      : `${modeLabel}（无本地复权因子，按不复权回放；源：${source === 'local' ? '本地库' : '网络'}）`;

  return {
    candles,
    adjustMode: isRawEvents ? 'none' : adjustMode,
    usedLocalFactors,
    raw: base,
    source,
    factorCount: factors.length,
    factors,
    note,
  };
}

export interface RunBacktestOnSymbolOptions
  extends LoadBacktestSeriesOptions,
    PrepareOptions,
    BacktestOptions {}

/**
 * 便捷：不复权取数 → 本地复权合成（或 raw-events 公司行为）→ 规整 → 跑回测。
 * 返回 null 表示数据不足（配置失败）。
 */
export async function runBacktestOnSymbol(
  strategy: Strategy,
  symbol: Symbol,
  opts: RunBacktestOnSymbolOptions = {},
): Promise<BacktestResult | null> {
  const series = await loadBacktestSeries(symbol, opts);
  const prepared = prepareCandles(series.candles, {
    minBars: opts.minBars,
    startMs: opts.startMs,
    endMs: opts.endMs,
  });
  if (!prepared.ok) return null;
  const useRawEvents = opts.adjustMode === 'raw-events';
  return runBacktest(strategy, prepared.candles, {
    ...opts,
    corporateActions: useRawEvents ? series.factors : opts.corporateActions,
  });
}
