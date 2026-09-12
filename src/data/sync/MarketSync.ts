/**
 * 全市场数据增量同步引擎（量化本地库底座）。
 *
 * 职责：
 *  1. syncTickers()           —— 拉全市场标的清单入本地 tickers 表；
 *  2. syncKlineIncremental()  —— 对全市场标的增量同步 K 线：
 *        - 已同步且未到刷新间隔（MIN_SYNC_INTERVAL）的标的跳过；
 *        - 已同步但本地最新 bar 落后于今天（跨日）时，只拉最近 INCREMENTAL_COUNT 根增量写库；
 *        - 本地无任何 K 线的标的拉 FULL_HISTORY_COUNT（约 3 年日线）；
 *        - 每标的完成后记录 sync_state.lastSyncMs（成功防抖，失败不计）。
 *  3. syncDaily()             —— 每日增量入口（周期=day）。
 *
 * 幂等：写库走 KlineDatabase.saveCandles（按 symbol+period+ts 去重 upsert），
 * 重复同步只覆盖同 ts，不会产生重复行。
 *
 * 并发：默认串行（限速友好，避免打爆同花顺 QPS）；可传 concurrency>1 并行。
 */
import { marketData } from '@/data/api';
import { database } from '@/data/db';
import { MarketMetaStore } from '@/data/db/MarketMetaStore';
import { isIndexSymbol } from '@/domain/symbol';
import { logger } from '@/utils/logger';
import type { Candle, Instrument, KlinePeriod, Symbol } from '@/data/api';

/** 同一标的两次同步的最小间隔（毫秒）：盘中高频调用会跳过，避免无谓请求 */
export const MIN_SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 分钟

/** listTickers 分页大小 */
const TICKER_PAGE = 1000;

/** 分页安全上限：防止上游 offset 失效导致死循环（个股+ETF 约 6k，留足余量） */
const MAX_TICKER_PAGES = 30;

/** 每日同步覆盖的资产类型：沪深北个股 + 场内 ETF/LOF（不含场外基金/债券） */
export const SYNC_ASSET_TYPES = ['a-share', 'fund-etf', 'fund-lof'] as const;

/** 每次增量拉取的 K 线根数（日线：约 2 个交易月，覆盖跨周/节假日） */
export const INCREMENTAL_COUNT = 60;

/**
 * 首次全量拉取根数：约 3 年日线（A 股年均约 243 个交易日）。
 * 未同步过的标的用这个值，避免只存 60 根导致回测/指标历史不足。
 */
export const FULL_HISTORY_COUNT = 750;

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

/**
 * 拉取全市场「可交易股票/场内基金」清单。
 *
 * 默认 a-share + fund-etf + fund-lof；不传 assetType 时上游会返回场外基金等
 * 全部类型（曾出现 6w+ 条），日 K 同步不需要。按 exchange.code 去重 + 分页上限。
 */
async function fetchAllTickers(
  assetTypes: readonly string[] = SYNC_ASSET_TYPES,
): Promise<Instrument[]> {
  const seen = new Set<string>();
  const out: Instrument[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_TICKER_PAGES; page++) {
    const batch = await marketData.listTickers({
      limit: TICKER_PAGE,
      offset,
      // 上游支持逗号分隔多值；类型层是单值联合，运行时原样透传
      assetType: assetTypes.join(',') as never,
    });
    if (!batch || batch.length === 0) break;
    let added = 0;
    for (const it of batch) {
      if (!it?.symbol?.code) continue;
      const key = `${it.symbol.exchange}.${it.symbol.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
      added += 1;
    }
    // 不足一页、或本页全是重复（offset 失效）→ 结束
    if (batch.length < TICKER_PAGE || added === 0) break;
    offset += TICKER_PAGE;
  }
  return out;
}

/** 沪深北个股代码 */
function isEquityCode(code: string): boolean {
  return /^(60\d{4}|68\d{4}|00\d{4}|30\d{4}|8\d{4}|4\d{4}|92\d{4})$/.test(code);
}

/** 场内 ETF/LOF：沪 5xxxxx，深 15/16/18 开头 */
function isListedFundSyncCode(code: string): boolean {
  return /^(5\d{5}|(15|16|18)\d{4})$/.test(code);
}

/** 同步 universe：个股 + 场内 ETF/LOF（排除指数/债券/场外基金脏数据） */
function isSyncableTicker(symbolKey: string): boolean {
  const code = symbolKey.split('.')[1] ?? symbolKey;
  return isEquityCode(code) || isListedFundSyncCode(code);
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
 * @param count 已有历史时每次拉取根数（增量）；首次无本地数据时用 FULL_HISTORY_COUNT
 * @param onProgress 进度回调（UI 展示用）
 */
export async function syncKlineIncremental(
  period: KlinePeriod = 'day',
  count: number = INCREMENTAL_COUNT,
  onProgress?: (p: SyncProgress) => void,
): Promise<SyncResult> {
  const store = new MarketMetaStore();
  const started = Date.now();
  let tickers = await store.getTickers();

  // 本地标的库若明显过大（历史未过滤 assetType 时曾写入 6w+ 含场外基金/债券），强制重建
  if (tickers.length > 20000) {
    log.warn?.('标的库异常偏大，按 a-share+ETF 重建', { count: tickers.length });
    tickers = await store.replaceTickers(await fetchAllTickers()).then(() => store.getTickers());
  }

  // 无标的库时先拉一次
  const list = tickers.length > 0 ? tickers : await store.replaceTickers(await fetchAllTickers()).then(() => store.getTickers());
  // 只同步个股 + 场内 ETF/LOF
  const universe = list.filter((t) => isSyncableTicker(t.symbol));

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

      const candles = await marketData.getKline({
        symbol,
        period,
        // 本地无任何 K 线 = 首次全量（约 3 年）；已有历史则只补最近增量
        count: latest ? count : FULL_HISTORY_COUNT,
      });
      if (candles && candles.length > 0) {
        await database().saveCandles(symbol, period, candles);
      }

      // 复权因子：仅 A 股个股有分红送转；指数/板块/港股美股无复权因子，跳过。
      // 10xxxxx/11xxxxx/12xxxxx 等为转债/债券代码，不是个股，一并跳过。
      const isEquityCode = /^(60\d{4}|68\d{4}|00\d{4}|30\d{4}|8\d{4}|4\d{4}|92\d{4})$/.test(
        symbol.code,
      );
      if (
        isEquityCode &&
        !isIndexSymbol(symbol) &&
        (symbol.exchange === 'SH' || symbol.exchange === 'SZ' || symbol.exchange === 'BJ')
      ) {
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

/** 每日增量入口：同步标的库 + 日 K 增量 + 估值快照 */
export async function syncDaily(onProgress?: (p: SyncProgress) => void): Promise<SyncResult> {
  await syncTickers();
  const res = await syncKlineIncremental('day', INCREMENTAL_COUNT, onProgress);
  // 估值（PE/PB）不阻塞 K 线结果；失败仅 warn
  try {
    await syncValuations();
  } catch (e) {
    log.warn?.('估值同步失败', e);
  }
  return res;
}

/**
 * 全市场个股估值快照写入本地缓存（PE/PB 等）。
 * 成分股列表等页面优先读缓存，减少每次打开都打上游。
 */
export async function syncValuations(chunk = 80): Promise<number> {
  const store = new MarketMetaStore();
  const tickers = (await store.getTickers()).filter((t) => isSyncableTicker(t.symbol));
  if (tickers.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < tickers.length; i += chunk) {
    const batch = tickers.slice(i, i + chunk);
    const symbols = batch.map((t) => ({
      code: t.symbol.split('.')[1] ?? t.symbol,
      exchange: (t.symbol.split('.')[0] as Symbol['exchange']) ?? 'SH',
    }));
    try {
      const vals = await marketData.getValuations(symbols);
      n += vals.length;
    } catch (e) {
      log.warn?.(`估值分片失败 i=${i}`, e);
    }
  }
  log.info?.('估值同步完成', { requested: tickers.length, got: n });
  return n;
}

/** 是否同一交易日（按中国时区粗略比较 ymd） */
function isSameTradingDay(datetime: number | string, nowMs: number): boolean {
  const d = typeof datetime === 'number' ? new Date(datetime) : new Date(datetime);
  const n = new Date(nowMs);
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}
