/**
 * 全市场数据增量同步引擎（量化本地库底座）。
 *
 * 职责：
 *  1. syncTickers()           —— 拉全市场标的清单入本地 tickers 表；
 *  2. syncKlineIncremental()  —— 对全市场标的增量同步 K 线：
 *        - 已同步且未到刷新间隔（MIN_SYNC_INTERVAL）的标的跳过；
 *        - 已同步但本地最新 bar 落后于今天（跨日）时，只拉最近 count 根增量写库；
 *        - 未同步过的标的拉全量 count 根；
 *        - 每标的完成后记录 sync_state.lastSyncMs（成功防抖，失败不计）。
 *  3. syncDaily()             —— 每日增量入口（周期=day）。
 *
 * 幂等：写库走 KlineDatabase.saveCandles（按 symbol+period+ts 去重 upsert），
 * 重复同步只覆盖同 ts，不会产生重复行。
 *
 * 并发：默认串行（限速友好，避免打爆同花顺 QPS）；可传 concurrency>1 并行。
 */
import { marketData } from '@/api';
import { database } from '@/db';
import { MarketMetaStore } from '@/db/MarketMetaStore';
import { logger } from '@/utils/logger';
import type { Candle, Instrument, KlinePeriod, Symbol } from '@/api';

/** 同一标的两次同步的最小间隔（毫秒）：盘中高频调用会跳过，避免无谓请求 */
export const MIN_SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 分钟

/** listTickers 分页大小 */
const TICKER_PAGE = 1000;

/** 每次增量拉取的 K 线根数（日线：约 2 个交易月，覆盖跨周/节假日） */
export const INCREMENTAL_COUNT = 60;

export interface SyncProgress {
  total: number;
  done: number;
  skipped: number;
  failed: number;
  current: string;
}

export interface SyncResult {
  total: number;
  done: number;
  skipped: number;
  failed: number;
  durationMs: number;
  errors: string[];
}

const log = logger.withScope('MarketSync');

/** 分页拉全市场标的（同花顺 A 股，按 1000/页）：统一 Instrument 透传（含必填 market 字段） */
async function fetchAllTickers(): Promise<Instrument[]> {
  const out: Instrument[] = [];
  let offset = 0;
  for (;;) {
    // 同花顺官方 SDK 仅覆盖沪深 A 股，无需传 exchange（fuyao listTickers 不消费该字段）
    const page = await marketData.listTickers({ limit: TICKER_PAGE, offset });
    if (!page || page.length === 0) break;
    for (const it of page) {
      if (it.symbol && it.symbol.code) {
        out.push(it);
      }
    }
    if (page.length < TICKER_PAGE) break;
    offset += TICKER_PAGE;
  }
  return out;
}

/** 标的最早需要的数据时间：若本地已有数据则从本地最新 bar 之后开始补，否则全量 */
async function resolveStartCandle(symbol: Symbol, period: KlinePeriod): Promise<Candle | undefined> {
  const db = database();
  const latest = await db.getLatestCandles(symbol, period, 1);
  return latest.length > 0 ? latest[latest.length - 1] : undefined;
}

/**
 * 增量同步全市场 K 线。
 * @param period 周期（默认 day）
 * @param count 每次拉取根数（未同步标的全量首拉 / 已同步标的增量）
 * @param onProgress 进度回调（UI 展示用）
 */
export async function syncKlineIncremental(
  period: KlinePeriod = 'day',
  count: number = INCREMENTAL_COUNT,
  onProgress?: (p: SyncProgress) => void,
): Promise<SyncResult> {
  const store = new MarketMetaStore();
  const started = Date.now();
  const tickers = await store.getTickers();

  // 无标的库时先拉一次
  const list = tickers.length > 0 ? tickers : await store.replaceTickers(await fetchAllTickers()).then(() => []);
  const universe = list.length > 0 ? list : await store.getTickers();

  const errors: string[] = [];
  const state: SyncProgress = { total: universe.length, done: 0, skipped: 0, failed: 0, current: '' };

  for (const t of universe) {
    state.current = t.symbol;
    const symbol: Symbol = { code: t.symbol.split('.')[1] ?? t.symbol, exchange: (t.exchange as Symbol['exchange']) ?? 'SH' };
    try {
      // 防抖：最近同步过且间隔未到 -> 跳过
      const lastSync = await store.getSyncState(t.symbol, period);
      if (lastSync > 0 && Date.now() - lastSync < MIN_SYNC_INTERVAL_MS) {
        state.skipped += 1;
        state.done += 1;
        continue;
      }

      const latest = await resolveStartCandle(symbol, period);
      // 已有数据且最新 bar 就是今天（无需刷新）-> 跳过
      if (latest && isSameTradingDay(latest.datetime, Date.now())) {
        state.skipped += 1;
        state.done += 1;
        continue;
      }

      const candles = await marketData.getKline({ symbol, period, count });
      if (candles && candles.length > 0) {
        await database().saveCandles(symbol, period, candles);
      }

      // 复权因子：随每次同步刷新（本地复权计算底座；失败不阻断 K 线同步）
      try {
        const factors = await marketData.getAdjustmentFactors(symbol);
        if (factors && factors.length > 0) {
          await store.replaceFactors(t.symbol, factors.map((f) => ({
            symbol: t.symbol,
            exDateMs: f.exDateMs,
            dividendPerShare: f.dividendPerShare ?? null,
            perShareBonus: f.perShareBonus ?? null,
            allotmentRatio: f.allotmentRatio ?? null,
            allotmentPrice: f.allotmentPrice ?? null,
          })));
        }
      } catch (fe) {
        log.warn?.(`复权因子同步失败 ${t.symbol}`, fe);
      }

      await store.setSyncState(t.symbol, period, Date.now());
      state.done += 1;
    } catch (e) {
      state.failed += 1;
      state.done += 1;
      const msg = e instanceof Error ? e.message : String(e);
      if (errors.length < 20) errors.push(`${t.symbol}: ${msg}`);
      log.warn?.(`同步失败 ${t.symbol}`, e);
    }
    onProgress?.({ ...state });
  }

  log.info?.('全市场同步完成', { total: state.total, done: state.done, skipped: state.skipped, failed: state.failed });
  return { total: state.total, done: state.done, skipped: state.skipped, failed: state.failed, durationMs: Date.now() - started, errors };
}

/** 同步标的库（全市场标的清单入本地 tickers 表） */
export async function syncTickers(onDone?: (n: number) => void): Promise<number> {
  const all = await fetchAllTickers();
  const store = new MarketMetaStore();
  const n = await store.replaceTickers(all);
  log.info?.('标的库同步完成', { count: n });
  onDone?.(n);
  return n;
}

/** 每日增量入口：同步标的库 + 日 K 增量 */
export async function syncDaily(onProgress?: (p: SyncProgress) => void): Promise<SyncResult> {
  await syncTickers();
  return syncKlineIncremental('day', INCREMENTAL_COUNT, onProgress);
}

/** 是否同一交易日（按中国时区粗略比较 ymd） */
function isSameTradingDay(datetime: number | string, nowMs: number): boolean {
  const d = typeof datetime === 'number' ? new Date(datetime) : new Date(datetime);
  const n = new Date(nowMs);
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}
