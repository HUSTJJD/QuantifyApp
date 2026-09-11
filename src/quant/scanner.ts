/**
 * 全市场扫描选股引擎：基于本地量化库遍历全部标的，按指标条件筛选候选股。
 *
 * 典型用法：scanMarket({ macdGoldenCross: true }) —— 遍历本地 tickers，
 * 对每个标的读不复权日 K（必要时聚合），计算 MACD/MA/RSI 等指标，命中条件即入选。
 *
 * 性能：本地 SQLite 行级读取 + 纯内存计算；全 A 约 5000+ 标的，串行扫描约数秒~数十秒，
 * 建议在后台任务执行并节流回调进度。
 */
import { database } from '@/data/db';
import { MarketMetaStore } from '@/data/db/MarketMetaStore';
import { macd, sma, rsi } from '@/quant/indicators';
import { closes } from '@/quant/indicators';
import type { Candle, Symbol } from '@/data/api';

export interface ScanCriteria {
  /** MACD 金叉：DIF 上穿 DEA */
  macdGoldenCross?: boolean;
  /** 均线多头排列：MA5 > MA10 > MA20 */
  maBullish?: boolean;
  /** RSI(14) 处于 [minRsi, maxRsi]（默认 30~70 过滤超买超卖） */
  rsiRange?: { min?: number; max?: number };
  /** 最近 bar 涨幅 >= 该值（%） */
  minGainPct?: number;
  /** 放量倍数：当日成交量 >= 近 volumeMaPeriod 日均量的该倍数（硬条件） */
  volumeSpikeRatio?: number;
  /** 均量周期（默认 5） */
  volumeMaPeriod?: number;
  /** N 日新高：最新收盘价创近 N 日（含当日）最高（硬条件） */
  newHighDays?: number;
  /** 最少 K 线根数（不足则跳过，默认 60） */
  minBars?: number;
}

export interface ScanHit {
  symbol: Symbol;
  name: string;
  /** 命中原因 */
  reasons: string[];
  /** 最新收盘价 */
  lastClose: number;
  /** 最新涨跌幅（%） */
  changePct: number | null;
  /** 指标快照（诊断用） */
  metrics: Record<string, number | string>;
}

export interface ScanProgress {
  total: number;
  done: number;
  hits: number;
  current: string;
}

export interface ScanResult {
  hits: ScanHit[];
  total: number;
  durationMs: number;
}

/** 逐条命中判断 */
export function evaluate(candles: Candle[], criteria: ScanCriteria, name: string): ScanHit | null {
  const n = candles.length;
  const minBars = criteria.minBars ?? 60;
  if (n < minBars) return null;

  const close = closes(candles);
  const reasons: string[] = [];
  const metrics: Record<string, number | string> = { bars: n };

  // MACD 金叉（需 > 1 根有效 DIF/DEA）
  if (criteria.macdGoldenCross) {
    const { dif, dea } = macd(close);
    const i = n - 1;
    if (!Number.isNaN(dif[i]) && !Number.isNaN(dea[i]) && !Number.isNaN(dif[i - 1]) && !Number.isNaN(dea[i - 1])) {
      if (dif[i - 1] <= dea[i - 1] && dif[i] > dea[i]) {
        reasons.push('MACD 金叉');
      }
      metrics.dif = round3(dif[i]);
      metrics.dea = round3(dea[i]);
    }
  }

  // 均线多头排列
  if (criteria.maBullish) {
    const ma5 = sma(close, 5);
    const ma10 = sma(close, 10);
    const ma20 = sma(close, 20);
    const i = n - 1;
    if (![ma5[i], ma10[i], ma20[i]].some(Number.isNaN) && ma5[i] > ma10[i] && ma10[i] > ma20[i]) {
      reasons.push('均线多头排列');
    }
    metrics.ma5 = round3(ma5[i]);
    metrics.ma10 = round3(ma10[i]);
    metrics.ma20 = round3(ma20[i]);
  }

  // RSI 区间
  if (criteria.rsiRange) {
    const r = rsi(close, 14);
    const v = r[n - 1];
    if (!Number.isNaN(v)) {
      const min = criteria.rsiRange.min ?? -Infinity;
      const max = criteria.rsiRange.max ?? Infinity;
      if (v >= min && v <= max) {
        reasons.push(`RSI ${v.toFixed(1)} 在区间`);
      } else {
        return null; // RSI 区间是硬条件：不满足直接淘汰
      }
      metrics.rsi = round3(v);
    }
  }

  // 涨幅
  if (criteria.minGainPct != null) {
    const prev = close[n - 2];
    const last = close[n - 1];
    if (prev > 0) {
      const pct = ((last - prev) / prev) * 100;
      metrics.changePct = round3(pct);
      if (pct >= criteria.minGainPct) {
        reasons.push(`涨 ${pct.toFixed(2)}%`);
      } else {
        return null;
      }
    }
  }

  // 放量（成交量 / 近 period 日均量）——硬条件
  if (criteria.volumeSpikeRatio != null) {
    const vols = candles.map((c) => c.volume);
    const period = criteria.volumeMaPeriod ?? 5;
    const vma = sma(vols, period);
    const vi = n - 1;
    const avg = vma[vi];
    const cur = vols[vi];
    const ratio = avg > 0 ? cur / avg : 0;
    metrics.volRatio = round3(ratio);
    if (avg > 0 && ratio >= criteria.volumeSpikeRatio) {
      reasons.push(`放量 ${metrics.volRatio}x`);
    } else {
      return null; // 放量是硬条件：不满足直接淘汰
    }
  }

  // N 日新高（收盘价创近 N 日最高）——硬条件
  if (criteria.newHighDays != null) {
    const k = Math.min(Math.max(criteria.newHighDays, 1), n);
    const hi = Math.max(...close.slice(n - k));
    metrics.newHigh = round3(hi);
    if (close[n - 1] >= hi - 1e-9) {
      reasons.push(`${k}日新高`);
    } else {
      return null; // 新高是硬条件：不满足直接淘汰
    }
  }

  if (reasons.length === 0) return null;
  const prev = close[n - 2];
  const last = close[n - 1];
  return {
    symbol: { code: '', exchange: 'SH' }, // 由调用方填充
    name,
    reasons,
    lastClose: last,
    changePct: prev > 0 ? round3(((last - prev) / prev) * 100) : null,
    metrics,
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * 全市场扫描。本地标的库 → 逐标的读不复权日 K → 指标筛选。
 * @param criteria 筛选条件
 * @param onProgress 进度回调（节流由调用方控制）
 * @param limit 最多返回命中数（0 表示不限）
 */
export async function scanMarket(
  criteria: ScanCriteria,
  onProgress?: (p: ScanProgress) => void,
  limit = 50,
): Promise<ScanResult> {
  const started = Date.now();
  const store = new MarketMetaStore();
  const tickers = await store.getTickers();
  const db = database();

  const hits: ScanHit[] = [];
  const progress: ScanProgress = { total: tickers.length, done: 0, hits: 0, current: '' };

  for (const t of tickers) {
    progress.current = t.symbol;
    const symbol: Symbol = { code: t.symbol.split('.')[1] ?? t.symbol, exchange: (t.exchange as Symbol['exchange']) ?? 'SH' };
    try {
      const candles = await db.getCandles(symbol, 'day');
      if (candles && candles.length > 0) {
        const hit = evaluate(candles, criteria, t.name ?? '');
        if (hit) {
          hit.symbol = symbol;
          hits.push(hit);
          progress.hits = hits.length;
        }
      }
    } catch {
      // 单标失败跳过
    }
    progress.done += 1;
    onProgress?.({ ...progress });
    if (limit > 0 && hits.length >= limit) break;
  }

  return { hits, total: tickers.length, durationMs: Date.now() - started };
}
