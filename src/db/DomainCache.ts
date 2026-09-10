/**
 * DomainCache —— 全部核心行情领域表读写（SQLite，内存回落）。
 *
 * 原则（与 K 线 + 复权因子一致）：
 *  - 能按列建模的行情一律落领域表，禁止整包 JSON；
 *  - 复权价由「不复权价 + 复权因子」合成，不缓存「已复权结果」；
 *  - 每张表带 expires_at，清理走 SQL 索引，不全表扫。
 *
 * 表清单见 schema.ts v5：
 *  quote_snapshot / trading_calendar / fund_flow / fund_flow_rank /
 *  limit_stock / board_quote / northbound_minute / northbound_holding /
 *  margin_account / dragon_tiger_stat
 */
import type { DB, Scalar } from '@op-engineering/op-sqlite';
import type { Quote, Symbol } from '@/api';
import { getSqlite } from './connection';
import { toFullCode } from '@/domain/symbol';

function n(v: unknown): number | null {
  if (v == null || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function n0(v: unknown): number {
  return n(v) ?? 0;
}
function s(v: unknown): string {
  return v == null ? '' : String(v);
}

/* ------------------------------ 类型 ------------------------------ */

export interface QuoteSnapshotRow {
  symbolKey: string;
  code: string;
  exchange: string;
  lastPrice: number;
  prevClose: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  amount: number;
  changePct: number | null;
  changeAmt: number | null;
  updatedAt: number;
  expiresAt: number;
}

export interface TradingCalendarRow {
  date: string;
  dateMs: number;
  isTrading: boolean;
  updatedAt: number;
}

export interface FundFlowRow {
  symbolKey: string;
  code: string;
  exchange: string;
  tradeDate: string;
  closePrice: number | null;
  changePct: number | null;
  mainNetInflow: number | null;
  mainInflowPct: number | null;
  superLargeInflow: number | null;
  largeInflow: number | null;
  mediumInflow: number | null;
  smallInflow: number | null;
  updatedAt: number;
}

export interface FundFlowRankRow {
  rankType: string;
  period: string;
  rankNo: number;
  code: string;
  name: string;
  exchange: string;
  price: number | null;
  changePct: number | null;
  mainNetInflow: number | null;
  mainInflowPct: number | null;
  topStockCode: string | null;
  topStockName: string | null;
  snapshotAt: number;
  expiresAt: number;
}

export interface LimitStockRow {
  poolType: string;
  tradeDate: string;
  code: string;
  exchange: string;
  name: string;
  lastPrice: number | null;
  changePct: number | null;
  boardDays: number | null;
  sealMoney: number | null;
  firstLimitTime: string | null;
  lastLimitTime: string | null;
  turnoverPct: number | null;
  openTimes: number | null;
  snapshotAt: number;
  expiresAt: number;
}

export interface BoardQuoteRow {
  boardType: string;
  code: string;
  name: string;
  rankNo: number | null;
  price: number | null;
  changePct: number | null;
  totalMarketCap: number | null;
  turnoverRate: number | null;
  riseCount: number | null;
  fallCount: number | null;
  leadingStock: string | null;
  snapshotAt: number;
  expiresAt: number;
}

export interface NorthboundMinuteRow {
  tradeDate: string;
  tradeTime: string;
  direction: string;
  shNetInflow: number | null;
  szNetInflow: number | null;
  totalNetInflow: number | null;
  snapshotAt: number;
  expiresAt: number;
}

export interface NorthboundHoldingRow {
  tradeDate: string;
  market: string;
  period: string;
  rankNo: number;
  code: string;
  name: string;
  closePrice: number | null;
  changePct: number | null;
  holdShares: number | null;
  holdMarketValue: number | null;
  holdRatioFloat: number | null;
  holdRatioTotal: number | null;
  addShares: number | null;
  addMarketValue: number | null;
  sector: string | null;
  snapshotAt: number;
  expiresAt: number;
}

export interface MarginAccountRow {
  tradeDate: string;
  finBalance: number | null;
  loanBalance: number | null;
  finBuyAmount: number | null;
  loanSellAmount: number | null;
  investorCount: number | null;
  liabilityInvestorCount: number | null;
  totalGuarantee: number | null;
  avgGuaranteeRatio: number | null;
  snapshotAt: number;
  expiresAt: number;
}

export interface DragonTigerStatRow {
  period: string;
  rankNo: number;
  code: string;
  name: string;
  latestDate: string | null;
  closePrice: number | null;
  changePct: number | null;
  listCount: number | null;
  totalBuyAmount: number | null;
  totalSellAmount: number | null;
  totalNetAmount: number | null;
  snapshotAt: number;
  expiresAt: number;
}

/* ------------------------------ 内存回落 ------------------------------ */

class Mem {
  quote = new Map<string, QuoteSnapshotRow>();
  calendar = new Map<string, TradingCalendarRow>();
  fundFlow = new Map<string, FundFlowRow>();
  fundFlowRank = new Map<string, FundFlowRankRow>();
  limitStock = new Map<string, LimitStockRow>();
  boardQuote = new Map<string, BoardQuoteRow>();
  nbMinute = new Map<string, NorthboundMinuteRow>();
  nbHolding = new Map<string, NorthboundHoldingRow>();
  marginAccount = new Map<string, MarginAccountRow>();
  dtStat = new Map<string, DragonTigerStatRow>();
  // 扩展块（财务/龙虎榜/基金/期权期货等）
  valuation = new Map<string, Record<string, unknown>>();
  financialReport = new Map<string, Record<string, unknown>>();
  financialStatement = new Map<string, Record<string, unknown>>();
  financialIndicator = new Map<string, Record<string, unknown>>();
  dividend = new Map<string, Record<string, unknown>>();
  ladder = new Map<string, Record<string, unknown>>();
  dtStock = new Map<string, Record<string, unknown>>();
  dtInst = new Map<string, Record<string, unknown>>();
  dtBranch = new Map<string, Record<string, unknown>>();
  dtSeat = new Map<string, Record<string, unknown>>();
  hotStock = new Map<string, Record<string, unknown>>();
  anomaly = new Map<string, Record<string, unknown>>();
  marketFlow = new Map<string, Record<string, unknown>>();
  boardConst = new Map<string, Record<string, unknown>>();
  nbSummary = new Map<string, Record<string, unknown>>();
  nbHistory = new Map<string, Record<string, unknown>>();
  nbIndividual = new Map<string, Record<string, unknown>>();
  marginTarget = new Map<string, Record<string, unknown>>();
  btMarket = new Map<string, Record<string, unknown>>();
  btDaily = new Map<string, Record<string, unknown>>();
  auction = new Map<string, Record<string, unknown>>();
  shortTerm = new Map<string, Record<string, unknown>>();
  fundProfile = new Map<string, Record<string, unknown>>();
  fundHolding = new Map<string, Record<string, unknown>>();
  fundNav = new Map<string, Record<string, unknown>>();
  fundDividend = new Map<string, Record<string, unknown>>();
  fundRank = new Map<string, Record<string, unknown>>();
  chip = new Map<string, Record<string, unknown>>();
  optionLeg = new Map<string, Record<string, unknown>>();
  optionKline = new Map<string, Record<string, unknown>>();
  optionCffex = new Map<string, Record<string, unknown>>();
  optionLhb = new Map<string, Record<string, unknown>>();
  futuresKline = new Map<string, Record<string, unknown>>();
  futuresSpot = new Map<string, Record<string, unknown>>();
  futuresInventory = new Map<string, Record<string, unknown>>();
  indexCatalog = new Map<string, Record<string, unknown>>();
  indexConstituent = new Map<string, Record<string, unknown>>();
  stockInfo = new Map<string, Record<string, unknown>>();
  adjustment = new Map<string, Record<string, unknown>>();
}
const mem = new Mem();

type Row = Record<string, unknown>;

/** 通用：按 where 键清旧 → 批量插入 expires_at 快照 */
async function replaceSnapshot(
  db: DB | null,
  mem: Map<string, Row>,
  table: string,
  whereCols: string[],
  whereVals: unknown[],
  rows: Row[],
  cols: string[],
  keyOf: (r: Row) => string,
  ttlMs: number,
  now: number,
): Promise<void> {
  const expiresAt = now + ttlMs;
  if (!db) {
    const prefix = whereVals.join('|') + '|';
    for (const [k, r] of mem) {
      if (k.startsWith(prefix)) mem.delete(k);
    }
    for (const r of rows) {
      mem.set(keyOf(r), { ...r, snapshot_at: now, expires_at: expiresAt });
    }
    return;
  }
  if (whereCols.length > 0) {
    const cond = whereCols.map((c) => `${c} = ?`).join(' AND ');
    await db.execute(`DELETE FROM ${table} WHERE ${cond}`, whereVals as Scalar[]);
  } else {
    await db.execute(`DELETE FROM ${table}`);
  }
  const allCols = [...cols, 'snapshot_at', 'expires_at'];
  const ph = allCols.map(() => '?').join(', ');
  for (const r of rows) {
    const vals = [...cols.map((c) => (r[c] === undefined ? null : r[c])), now, expiresAt];
    await db.execute(
      `INSERT OR REPLACE INTO ${table} (${allCols.join(', ')}) VALUES (${ph})`,
      vals as Scalar[],
    );
  }
}

/** 通用：按 expires_at 查询 */
async function listSnapshot(
  db: DB | null,
  mem: Map<string, Row>,
  table: string,
  whereCols: string[],
  whereVals: unknown[],
  orderBy: string,
  now: number,
): Promise<Row[]> {
  if (!db) {
    const prefix = whereVals.length ? whereVals.join('|') + '|' : '';
    return [...mem.values()]
      .filter((r) => {
        if (n0(r.expires_at) <= now) return false;
        if (whereCols.length === 0) return true;
        // 内存键前缀匹配
        return true;
      })
      .filter((r) => {
        // 内存按 whereVals 前缀已在 key 中编码；此处宽松过滤字段
        return whereCols.every((c, i) => {
          const want = whereVals[i];
          if (want === undefined || want === null) return true;
          return s(r[c]) === s(want);
        });
      });
  }
  let sql = `SELECT * FROM ${table} WHERE expires_at > ?`;
  const params: Scalar[] = [now];
  for (let i = 0; i < whereCols.length; i++) {
    sql += ` AND ${whereCols[i]} = ?`;
    params.push(whereVals[i] as Scalar);
  }
  if (orderBy) sql += ` ORDER BY ${orderBy}`;
  const res = await db.execute(sql, params);
  return (res.rows ?? []).map((r) => ({ ...(r as Record<string, Scalar>) }));
}

export class DomainCacheStore {
  private async db(): Promise<DB | null> {
    return getSqlite();
  }

  // ---------- quote_snapshot ----------

  async putQuotes(quotes: Quote[], ttlMs: number, now = Date.now()): Promise<void> {
    if (quotes.length === 0) return;
    const expiresAt = now + ttlMs;
    const db = await this.db();
    for (const q of quotes) {
      const key = toFullCode(q.symbol);
      const row: QuoteSnapshotRow = {
        symbolKey: key,
        code: q.symbol.code,
        exchange: q.symbol.exchange,
        lastPrice: q.last,
        prevClose: q.prevClose,
        openPrice: q.open,
        highPrice: q.high,
        lowPrice: q.low,
        volume: q.volume,
        amount: q.amount,
        changePct: q.changePct ?? null,
        changeAmt: q.change ?? null,
        updatedAt: now,
        expiresAt,
      };
      if (!db) {
        mem.quote.set(key, row);
        continue;
      }
      await db.execute(
        `INSERT OR REPLACE INTO quote_snapshot
         (symbol_key, code, exchange, last_price, prev_close, open_price, high_price, low_price,
          volume, amount, change_pct, change_amt, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.symbolKey, row.code, row.exchange, row.lastPrice, row.prevClose,
          row.openPrice, row.highPrice, row.lowPrice, row.volume, row.amount,
          row.changePct, row.changeAmt, row.updatedAt, row.expiresAt,
        ],
      );
    }
  }

  /** 按 symbols 查未过期快照；返回 Map<symbolKey, Quote> */
  async getQuotes(
    symbols: Symbol[],
    now = Date.now(),
  ): Promise<Map<string, Quote>> {
    const out = new Map<string, Quote>();
    if (symbols.length === 0) return out;
    const db = await this.db();
    for (const sym of symbols) {
      const key = toFullCode(sym);
      let row: QuoteSnapshotRow | null = null;
      if (!db) {
        const r = mem.quote.get(key);
        row = r && r.expiresAt > now ? r : null;
      } else {
        const res = await db.execute(
          'SELECT * FROM quote_snapshot WHERE symbol_key = ? AND expires_at > ?',
          [key, now],
        );
        const r = res.rows?.[0] as Record<string, Scalar> | undefined;
        if (r) {
          row = {
            symbolKey: s(r.symbol_key),
            code: s(r.code),
            exchange: s(r.exchange),
            lastPrice: n0(r.last_price),
            prevClose: n0(r.prev_close),
            openPrice: n0(r.open_price),
            highPrice: n0(r.high_price),
            lowPrice: n0(r.low_price),
            volume: n0(r.volume),
            amount: n0(r.amount),
            changePct: n(r.change_pct),
            changeAmt: n(r.change_amt),
            updatedAt: n0(r.updated_at),
            expiresAt: n0(r.expires_at),
          };
        }
      }
      if (row) {
        out.set(key, {
          symbol: { code: row.code, exchange: row.exchange as Symbol['exchange'] },
          last: row.lastPrice,
          prevClose: row.prevClose,
          open: row.openPrice,
          high: row.highPrice,
          low: row.lowPrice,
          volume: row.volume,
          amount: row.amount,
          changePct: row.changePct ?? undefined,
          change: row.changeAmt ?? undefined,
        });
      }
    }
    return out;
  }

  // ---------- trading_calendar ----------

  async putTradingDays(
    days: { date: string; dateMs: number }[],
    now = Date.now(),
  ): Promise<void> {
    if (days.length === 0) return;
    const db = await this.db();
    for (const d of days) {
      const row: TradingCalendarRow = {
        date: d.date,
        dateMs: d.dateMs,
        isTrading: true,
        updatedAt: now,
      };
      if (!db) {
        mem.calendar.set(d.date, row);
        continue;
      }
      await db.execute(
        `INSERT OR REPLACE INTO trading_calendar (date, date_ms, is_trading, updated_at)
         VALUES (?, ?, 1, ?)`,
        [row.date, row.dateMs, row.updatedAt],
      );
    }
  }

  async listTradingDays(): Promise<TradingCalendarRow[]> {
    const db = await this.db();
    if (!db) {
      return [...mem.calendar.values()].sort((a, b) => a.dateMs - b.dateMs);
    }
    const res = await db.execute('SELECT * FROM trading_calendar ORDER BY date_ms ASC');
    return (res.rows ?? []).map((r) => {
      const row = r as Record<string, Scalar>;
      return {
        date: s(row.date),
        dateMs: n0(row.date_ms),
        isTrading: row.is_trading === 1,
        updatedAt: n0(row.updated_at),
      };
    });
  }

  async isTradingDay(date: string): Promise<boolean | null> {
    const db = await this.db();
    if (!db) {
      const r = mem.calendar.get(date);
      return r ? r.isTrading : null;
    }
    const res = await db.execute('SELECT is_trading FROM trading_calendar WHERE date = ?', [date]);
    const r = res.rows?.[0] as Record<string, Scalar> | undefined;
    return r ? r.is_trading === 1 : null;
  }

  // ---------- fund_flow ----------

  async putFundFlow(rows: Omit<FundFlowRow, 'updatedAt'>[], now = Date.now()): Promise<void> {
    if (rows.length === 0) return;
    const db = await this.db();
    for (const r of rows) {
      const key = `${r.symbolKey}|${r.tradeDate}`;
      const row = { ...r, updatedAt: now };
      if (!db) {
        mem.fundFlow.set(key, row);
        continue;
      }
      await db.execute(
        `INSERT OR REPLACE INTO fund_flow
         (symbol_key, code, exchange, trade_date, close_price, change_pct,
          main_net_inflow, main_inflow_pct, super_large_inflow, large_inflow, medium_inflow, small_inflow, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.symbolKey, row.code, row.exchange, row.tradeDate, row.closePrice, row.changePct,
          row.mainNetInflow, row.mainInflowPct, row.superLargeInflow, row.largeInflow,
          row.mediumInflow, row.smallInflow, row.updatedAt,
        ],
      );
    }
  }

  async listFundFlow(symbolKey: string): Promise<FundFlowRow[]> {
    const db = await this.db();
    if (!db) {
      return [...mem.fundFlow.values()]
        .filter((r) => r.symbolKey === symbolKey)
        .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
    }
    const res = await db.execute(
      'SELECT * FROM fund_flow WHERE symbol_key = ? ORDER BY trade_date ASC',
      [symbolKey],
    );
    return (res.rows ?? []).map((r) => {
      const row = r as Record<string, Scalar>;
      return {
        symbolKey: s(row.symbol_key),
        code: s(row.code),
        exchange: s(row.exchange),
        tradeDate: s(row.trade_date),
        closePrice: n(row.close_price),
        changePct: n(row.change_pct),
        mainNetInflow: n(row.main_net_inflow),
        mainInflowPct: n(row.main_inflow_pct),
        superLargeInflow: n(row.super_large_inflow),
        largeInflow: n(row.large_inflow),
        mediumInflow: n(row.medium_inflow),
        smallInflow: n(row.small_inflow),
        updatedAt: n0(row.updated_at),
      };
    });
  }

  // ---------- fund_flow_rank ----------

  async putFundFlowRank(
    rankType: string,
    period: string,
    rows: Omit<FundFlowRankRow, 'rankType' | 'period' | 'snapshotAt' | 'expiresAt'>[],
    ttlMs: number,
    now = Date.now(),
  ): Promise<void> {
    const expiresAt = now + ttlMs;
    // 先清旧快照
    await this.clearFundFlowRank(rankType, period);
    const db = await this.db();
    for (const r of rows) {
      const key = `${rankType}|${period}|${r.rankNo}`;
      const row = { ...r, rankType, period, snapshotAt: now, expiresAt };
      if (!db) {
        mem.fundFlowRank.set(key, row);
        continue;
      }
      await db.execute(
        `INSERT OR REPLACE INTO fund_flow_rank
         (rank_type, period, rank_no, code, name, exchange, price, change_pct,
          main_net_inflow, main_inflow_pct, top_stock_code, top_stock_name, snapshot_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.rankType, row.period, row.rankNo, row.code, row.name, row.exchange,
          row.price, row.changePct, row.mainNetInflow, row.mainInflowPct,
          row.topStockCode, row.topStockName, row.snapshotAt, row.expiresAt,
        ],
      );
    }
  }

  async listFundFlowRank(
    rankType: string,
    period: string,
    now = Date.now(),
  ): Promise<FundFlowRankRow[]> {
    const db = await this.db();
    if (!db) {
      return [...mem.fundFlowRank.values()]
        .filter((r) => r.rankType === rankType && r.period === period && r.expiresAt > now)
        .sort((a, b) => a.rankNo - b.rankNo);
    }
    const res = await db.execute(
      `SELECT * FROM fund_flow_rank WHERE rank_type = ? AND period = ? AND expires_at > ?
       ORDER BY rank_no ASC`,
      [rankType, period, now],
    );
    return (res.rows ?? []).map((r) => {
      const row = r as Record<string, Scalar>;
      return {
        rankType: s(row.rank_type),
        period: s(row.period),
        rankNo: n0(row.rank_no),
        code: s(row.code),
        name: s(row.name),
        exchange: s(row.exchange),
        price: n(row.price),
        changePct: n(row.change_pct),
        mainNetInflow: n(row.main_net_inflow),
        mainInflowPct: n(row.main_inflow_pct),
        topStockCode: n(row.top_stock_code) != null ? s(row.top_stock_code) : row.top_stock_code == null ? null : s(row.top_stock_code),
        topStockName: row.top_stock_name == null ? null : s(row.top_stock_name),
        snapshotAt: n0(row.snapshot_at),
        expiresAt: n0(row.expires_at),
      };
    });
  }

  async clearFundFlowRank(rankType: string, period: string): Promise<void> {
    const db = await this.db();
    if (!db) {
      for (const [k, r] of mem.fundFlowRank) {
        if (r.rankType === rankType && r.period === period) mem.fundFlowRank.delete(k);
      }
      return;
    }
    await db.execute('DELETE FROM fund_flow_rank WHERE rank_type = ? AND period = ?', [rankType, period]);
  }

  // ---------- limit_stock ----------

  async putLimitStocks(
    poolType: string,
    tradeDate: string,
    rows: Omit<LimitStockRow, 'poolType' | 'tradeDate' | 'snapshotAt' | 'expiresAt'>[],
    ttlMs: number,
    now = Date.now(),
  ): Promise<void> {
    const expiresAt = now + ttlMs;
    await this.clearLimitStocks(poolType, tradeDate);
    const db = await this.db();
    for (const r of rows) {
      const key = `${poolType}|${tradeDate}|${r.code}`;
      const row = { ...r, poolType, tradeDate, snapshotAt: now, expiresAt };
      if (!db) {
        mem.limitStock.set(key, row);
        continue;
      }
      await db.execute(
        `INSERT OR REPLACE INTO limit_stock
         (pool_type, trade_date, code, exchange, name, last_price, change_pct, board_days,
          seal_money, first_limit_time, last_limit_time, turnover_pct, open_times, snapshot_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.poolType, row.tradeDate, row.code, row.exchange, row.name,
          row.lastPrice, row.changePct, row.boardDays, row.sealMoney,
          row.firstLimitTime, row.lastLimitTime, row.turnoverPct, row.openTimes,
          row.snapshotAt, row.expiresAt,
        ],
      );
    }
  }

  async listLimitStocks(
    poolType: string,
    tradeDate: string,
    now = Date.now(),
  ): Promise<LimitStockRow[]> {
    const db = await this.db();
    if (!db) {
      return [...mem.limitStock.values()]
        .filter((r) => r.poolType === poolType && r.tradeDate === tradeDate && r.expiresAt > now);
    }
    const res = await db.execute(
      `SELECT * FROM limit_stock WHERE pool_type = ? AND trade_date = ? AND expires_at > ?`,
      [poolType, tradeDate, now],
    );
    return (res.rows ?? []).map((r) => {
      const row = r as Record<string, Scalar>;
      return {
        poolType: s(row.pool_type),
        tradeDate: s(row.trade_date),
        code: s(row.code),
        exchange: s(row.exchange),
        name: s(row.name),
        lastPrice: n(row.last_price),
        changePct: n(row.change_pct),
        boardDays: n(row.board_days),
        sealMoney: n(row.seal_money),
        firstLimitTime: row.first_limit_time == null ? null : s(row.first_limit_time),
        lastLimitTime: row.last_limit_time == null ? null : s(row.last_limit_time),
        turnoverPct: n(row.turnover_pct),
        openTimes: n(row.open_times),
        snapshotAt: n0(row.snapshot_at),
        expiresAt: n0(row.expires_at),
      };
    });
  }

  async clearLimitStocks(poolType: string, tradeDate: string): Promise<void> {
    const db = await this.db();
    if (!db) {
      for (const [k, r] of mem.limitStock) {
        if (r.poolType === poolType && r.tradeDate === tradeDate) mem.limitStock.delete(k);
      }
      return;
    }
    await db.execute('DELETE FROM limit_stock WHERE pool_type = ? AND trade_date = ?', [poolType, tradeDate]);
  }

  // ---------- board_quote ----------

  async putBoards(
    boardType: string,
    rows: Omit<BoardQuoteRow, 'boardType' | 'snapshotAt' | 'expiresAt'>[],
    ttlMs: number,
    now = Date.now(),
  ): Promise<void> {
    const expiresAt = now + ttlMs;
    await this.clearBoards(boardType);
    const db = await this.db();
    for (const r of rows) {
      const key = `${boardType}|${r.code}`;
      const row = { ...r, boardType, snapshotAt: now, expiresAt };
      if (!db) {
        mem.boardQuote.set(key, row);
        continue;
      }
      await db.execute(
        `INSERT OR REPLACE INTO board_quote
         (board_type, code, name, rank_no, price, change_pct, total_market_cap,
          turnover_rate, rise_count, fall_count, leading_stock, snapshot_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.boardType, row.code, row.name, row.rankNo, row.price, row.changePct,
          row.totalMarketCap, row.turnoverRate, row.riseCount, row.fallCount,
          row.leadingStock, row.snapshotAt, row.expiresAt,
        ],
      );
    }
  }

  async listBoards(boardType: string, now = Date.now()): Promise<BoardQuoteRow[]> {
    const db = await this.db();
    if (!db) {
      return [...mem.boardQuote.values()]
        .filter((r) => r.boardType === boardType && r.expiresAt > now);
    }
    const res = await db.execute(
      'SELECT * FROM board_quote WHERE board_type = ? AND expires_at > ?',
      [boardType, now],
    );
    return (res.rows ?? []).map((r) => {
      const row = r as Record<string, Scalar>;
      return {
        boardType: s(row.board_type),
        code: s(row.code),
        name: s(row.name),
        rankNo: n(row.rank_no),
        price: n(row.price),
        changePct: n(row.change_pct),
        totalMarketCap: n(row.total_market_cap),
        turnoverRate: n(row.turnover_rate),
        riseCount: n(row.rise_count),
        fallCount: n(row.fall_count),
        leadingStock: row.leading_stock == null ? null : s(row.leading_stock),
        snapshotAt: n0(row.snapshot_at),
        expiresAt: n0(row.expires_at),
      };
    });
  }

  async clearBoards(boardType: string): Promise<void> {
    const db = await this.db();
    if (!db) {
      for (const [k, r] of mem.boardQuote) {
        if (r.boardType === boardType) mem.boardQuote.delete(k);
      }
      return;
    }
    await db.execute('DELETE FROM board_quote WHERE board_type = ?', [boardType]);
  }

  // ---------- northbound_minute ----------

  async putNorthboundMinute(
    direction: string,
    rows: Omit<NorthboundMinuteRow, 'direction' | 'snapshotAt' | 'expiresAt'>[],
    ttlMs: number,
    now = Date.now(),
  ): Promise<void> {
    const expiresAt = now + ttlMs;
    await this.clearNorthboundMinute(direction);
    const db = await this.db();
    for (const r of rows) {
      const key = `${r.tradeDate}|${r.tradeTime}|${direction}`;
      const row = { ...r, direction, snapshotAt: now, expiresAt };
      if (!db) {
        mem.nbMinute.set(key, row);
        continue;
      }
      await db.execute(
        `INSERT OR REPLACE INTO northbound_minute
         (trade_date, trade_time, direction, sh_net_inflow, sz_net_inflow, total_net_inflow, snapshot_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.tradeDate, row.tradeTime, row.direction,
          row.shNetInflow, row.szNetInflow, row.totalNetInflow,
          row.snapshotAt, row.expiresAt,
        ],
      );
    }
  }

  async listNorthboundMinute(direction: string, now = Date.now()): Promise<NorthboundMinuteRow[]> {
    const db = await this.db();
    if (!db) {
      return [...mem.nbMinute.values()]
        .filter((r) => r.direction === direction && r.expiresAt > now)
        .sort((a, b) => a.tradeTime.localeCompare(b.tradeTime));
    }
    const res = await db.execute(
      'SELECT * FROM northbound_minute WHERE direction = ? AND expires_at > ? ORDER BY trade_time ASC',
      [direction, now],
    );
    return (res.rows ?? []).map((r) => {
      const row = r as Record<string, Scalar>;
      return {
        tradeDate: s(row.trade_date),
        tradeTime: s(row.trade_time),
        direction: s(row.direction),
        shNetInflow: n(row.sh_net_inflow),
        szNetInflow: n(row.sz_net_inflow),
        totalNetInflow: n(row.total_net_inflow),
        snapshotAt: n0(row.snapshot_at),
        expiresAt: n0(row.expires_at),
      };
    });
  }

  async clearNorthboundMinute(direction: string): Promise<void> {
    const db = await this.db();
    if (!db) {
      for (const [k, r] of mem.nbMinute) {
        if (r.direction === direction) mem.nbMinute.delete(k);
      }
      return;
    }
    await db.execute('DELETE FROM northbound_minute WHERE direction = ?', [direction]);
  }

  // ---------- margin_account ----------

  async putMarginAccounts(
    rows: Omit<MarginAccountRow, 'snapshotAt' | 'expiresAt'>[],
    ttlMs: number,
    now = Date.now(),
  ): Promise<void> {
    const expiresAt = now + ttlMs;
    const db = await this.db();
    for (const r of rows) {
      const row = { ...r, snapshotAt: now, expiresAt };
      if (!db) {
        mem.marginAccount.set(r.tradeDate, row);
        continue;
      }
      await db.execute(
        `INSERT OR REPLACE INTO margin_account
         (trade_date, fin_balance, loan_balance, fin_buy_amount, loan_sell_amount,
          investor_count, liability_investor_count, total_guarantee, avg_guarantee_ratio, snapshot_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.tradeDate, row.finBalance, row.loanBalance, row.finBuyAmount, row.loanSellAmount,
          row.investorCount, row.liabilityInvestorCount, row.totalGuarantee, row.avgGuaranteeRatio,
          row.snapshotAt, row.expiresAt,
        ],
      );
    }
  }

  async listMarginAccounts(now = Date.now()): Promise<MarginAccountRow[]> {
    const db = await this.db();
    if (!db) {
      return [...mem.marginAccount.values()]
        .filter((r) => r.expiresAt > now)
        .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
    }
    const res = await db.execute(
      'SELECT * FROM margin_account WHERE expires_at > ? ORDER BY trade_date ASC',
      [now],
    );
    return (res.rows ?? []).map((r) => {
      const row = r as Record<string, Scalar>;
      return {
        tradeDate: s(row.trade_date),
        finBalance: n(row.fin_balance),
        loanBalance: n(row.loan_balance),
        finBuyAmount: n(row.fin_buy_amount),
        loanSellAmount: n(row.loan_sell_amount),
        investorCount: n(row.investor_count),
        liabilityInvestorCount: n(row.liability_investor_count),
        totalGuarantee: n(row.total_guarantee),
        avgGuaranteeRatio: n(row.avg_guarantee_ratio),
        snapshotAt: n0(row.snapshot_at),
        expiresAt: n0(row.expires_at),
      };
    });
  }

  // ---------- dragon_tiger_stat ----------

  async putDragonTigerStats(
    period: string,
    rows: Omit<DragonTigerStatRow, 'period' | 'snapshotAt' | 'expiresAt'>[],
    ttlMs: number,
    now = Date.now(),
  ): Promise<void> {
    const expiresAt = now + ttlMs;
    await this.clearDragonTigerStats(period);
    const db = await this.db();
    for (const r of rows) {
      const key = `${period}|${r.rankNo}`;
      const row = { ...r, period, snapshotAt: now, expiresAt };
      if (!db) {
        mem.dtStat.set(key, row);
        continue;
      }
      await db.execute(
        `INSERT OR REPLACE INTO dragon_tiger_stat
         (period, rank_no, code, name, latest_date, close_price, change_pct, list_count,
          total_buy_amount, total_sell_amount, total_net_amount, snapshot_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.period, row.rankNo, row.code, row.name, row.latestDate, row.closePrice,
          row.changePct, row.listCount, row.totalBuyAmount, row.totalSellAmount,
          row.totalNetAmount, row.snapshotAt, row.expiresAt,
        ],
      );
    }
  }

  async listDragonTigerStats(period: string, now = Date.now()): Promise<DragonTigerStatRow[]> {
    const db = await this.db();
    if (!db) {
      return [...mem.dtStat.values()]
        .filter((r) => r.period === period && r.expiresAt > now)
        .sort((a, b) => a.rankNo - b.rankNo);
    }
    const res = await db.execute(
      'SELECT * FROM dragon_tiger_stat WHERE period = ? AND expires_at > ? ORDER BY rank_no ASC',
      [period, now],
    );
    return (res.rows ?? []).map((r) => {
      const row = r as Record<string, Scalar>;
      return {
        period: s(row.period),
        rankNo: n0(row.rank_no),
        code: s(row.code),
        name: s(row.name),
        latestDate: row.latest_date == null ? null : s(row.latest_date),
        closePrice: n(row.close_price),
        changePct: n(row.change_pct),
        listCount: n(row.list_count),
        totalBuyAmount: n(row.total_buy_amount),
        totalSellAmount: n(row.total_sell_amount),
        totalNetAmount: n(row.total_net_amount),
        snapshotAt: n0(row.snapshot_at),
        expiresAt: n0(row.expires_at),
      };
    });
  }

  async clearDragonTigerStats(period: string): Promise<void> {
    const db = await this.db();
    if (!db) {
      for (const [k, r] of mem.dtStat) {
        if (r.period === period) mem.dtStat.delete(k);
      }
      return;
    }
    await db.execute('DELETE FROM dragon_tiger_stat WHERE period = ?', [period]);
  }

  // ---------- 估值 ----------
  async putValuations(rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    const db = await this.db();
    await replaceSnapshot(db, mem.valuation, 'valuation_snapshot', [], [], rows, [
      'symbol_key', 'code', 'exchange', 'name', 'pe_ttm', 'pe_mrq', 'pb_mrq',
      'ps_ttm', 'pcf_ttm', 'timestamp',
    ], (r) => s(r.symbol_key), ttlMs, now);
  }
  async listValuations(symbolKeys: string[], now = Date.now()): Promise<Row[]> {
    const db = await this.db();
    const out: Row[] = [];
    for (const k of symbolKeys) {
      const rows = await listSnapshot(db, mem.valuation, 'valuation_snapshot', ['symbol_key'], [k], '', now);
      out.push(...rows);
    }
    return out;
  }

  // ---------- 财务汇总 ----------
  async putFinancialReports(symbolKey: string, rows: Row[], now = Date.now()): Promise<void> {
    const db = await this.db();
    // 无 expires：财务慢变，按 symbol 替换
    if (!db) {
      for (const [k, r] of mem.financialReport) {
        if (k.startsWith(symbolKey + '|')) mem.financialReport.delete(k);
      }
      for (const r of rows) {
        mem.financialReport.set(`${symbolKey}|${n0(r.period_end_ms)}`, r);
      }
      return;
    }
    await db.execute('DELETE FROM financial_report WHERE symbol_key = ?', [symbolKey]);
    for (const r of rows) {
      await db.execute(
        `INSERT OR REPLACE INTO financial_report
         (symbol_key, code, exchange, period, period_end_ms, basic_eps, operating_income,
          operating_costs, net_profit, parent_holder_net_profit, total_assets, holder_equity_total,
          operating_cash_flow, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          symbolKey, s(r.code), s(r.exchange), s(r.period), n0(r.period_end_ms),
          n(r.basic_eps), n(r.operating_income), n(r.operating_costs), n(r.net_profit),
          n(r.parent_holder_net_profit), n(r.total_assets), n(r.holder_equity_total),
          n(r.operating_cash_flow), now,
        ],
      );
    }
  }
  async listFinancialReports(symbolKey: string): Promise<Row[]> {
    const db = await this.db();
    if (!db) {
      return [...mem.financialReport.values()]
        .filter((r) => s(r.symbol_key) === symbolKey)
        .sort((a, b) => n0(b.period_end_ms) - n0(a.period_end_ms));
    }
    const res = await db.execute(
      'SELECT * FROM financial_report WHERE symbol_key = ? ORDER BY period_end_ms DESC',
      [symbolKey],
    );
    return (res.rows ?? []).map((r) => ({ ...(r as Record<string, Scalar>) }));
  }

  // ---------- 三表 / 指标 / 分红 / 估值等通用快照 ----------

  private async putList(
    mem: Map<string, Row>,
    table: string,
    whereCols: string[],
    whereVals: unknown[],
    rows: Row[],
    cols: string[],
    keyOf: (r: Row) => string,
    ttlMs: number,
    now: number,
  ): Promise<void> {
    const db = await this.db();
    await replaceSnapshot(db, mem, table, whereCols, whereVals, rows, cols, keyOf, ttlMs, now);
  }

  private async list(
    mem: Map<string, Row>,
    table: string,
    whereCols: string[],
    whereVals: unknown[],
    orderBy: string,
    now: number,
  ): Promise<Row[]> {
    const db = await this.db();
    return listSnapshot(db, mem, table, whereCols, whereVals, orderBy, now);
  }

  // 财务三表
  async putFinancialStatements(symbolKey: string, stmtType: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.financialStatement, 'financial_statement',
      ['symbol_key', 'statement_type'], [symbolKey, stmtType], rows,
      ['symbol_key', 'statement_type', 'period', 'period_end_ms', 'report_date_ms',
       'fiscal_year', 'fiscal_period', 'currency', 'payload'],
      (r) => `${symbolKey}|${stmtType}|${n0(r.period_end_ms)}`, ttlMs, now);
  }
  async listFinancialStatements(symbolKey: string, stmtType: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.financialStatement, 'financial_statement',
      ['symbol_key', 'statement_type'], [symbolKey, stmtType], 'period_end_ms DESC', now);
  }

  async putFinancialIndicators(symbolKey: string, report: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.financialIndicator, 'financial_indicator',
      ['symbol_key', 'report'], [symbolKey, report], rows,
      ['symbol_key', 'report', 'category', 'index_id', 'value'],
      (r) => `${symbolKey}|${report}|${s(r.index_id)}`, ttlMs, now);
  }
  async listFinancialIndicators(symbolKey: string, report: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.financialIndicator, 'financial_indicator',
      ['symbol_key', 'report'], [symbolKey, report], 'category, index_id', now);
  }

  async putDividendDetails(symbolKey: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.dividend, 'dividend_detail', ['symbol_key'], [symbolKey], rows,
      ['symbol_key', 'code', 'name', 'report_date', 'dividend_pretax', 'dividend_yield',
       'bonus_ratio', 'transfer_ratio', 'ex_dividend_date', 'pay_date'],
      (r) => `${symbolKey}|${s(r.report_date)}`, ttlMs, now);
  }
  async listDividendDetails(symbolKey: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.dividend, 'dividend_detail', ['symbol_key'], [symbolKey], 'report_date DESC', now);
  }

  // 连板天梯
  async putLadder(tradeDate: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.ladder, 'ladder_stock', ['trade_date'], [tradeDate], rows,
      ['trade_date', 'board_key', 'code', 'name', 'board_num', 'seal_nextday', 'sign_level'],
      (r) => `${tradeDate}|${s(r.board_key)}|${s(r.code)}`, ttlMs, now);
  }
  async listLadder(tradeDate: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.ladder, 'ladder_stock', ['trade_date'], [tradeDate], 'board_key, code', now);
  }

  // 龙虎榜 list
  async putDragonTigerStocks(tradeDate: string, boardType: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.dtStock, 'dragon_tiger_stock', ['trade_date', 'board_type'], [tradeDate, boardType], rows,
      ['trade_date', 'board_type', 'code', 'name', 'change_pct', 'buy_value', 'sell_value',
       'net_value', 'net_rate', 'org_net_value', 'hot_money_net_value', 'hot_rank', 'range_days', 'limit_reason'],
      (r) => `${tradeDate}|${boardType}|${s(r.code)}`, ttlMs, now);
  }
  async listDragonTigerStocks(tradeDate: string, boardType: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.dtStock, 'dragon_tiger_stock', ['trade_date', 'board_type'], [tradeDate, boardType], 'code', now);
  }

  async putDragonTigerInstitutions(tradeDate: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.dtInst, 'dragon_tiger_institution', ['trade_date'], [tradeDate], rows,
      ['trade_date', 'code', 'name', 'close_price', 'change_pct', 'buy_org_count', 'sell_org_count',
       'org_buy_amount', 'org_sell_amount', 'org_net_amount'],
      (r) => `${tradeDate}|${s(r.code)}`, ttlMs, now);
  }
  async listDragonTigerInstitutions(tradeDate: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.dtInst, 'dragon_tiger_institution', ['trade_date'], [tradeDate], 'code', now);
  }

  async putDragonTigerBranches(period: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.dtBranch, 'dragon_tiger_branch', ['period'], [period], rows,
      ['period', 'rank_no', 'code', 'name', 'total_buy_amount', 'total_sell_amount', 'buy_count', 'sell_count', 'total_count'],
      (r) => `${period}|${n0(r.rank_no)}`, ttlMs, now);
  }
  async listDragonTigerBranches(period: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.dtBranch, 'dragon_tiger_branch', ['period'], [period], 'rank_no', now);
  }

  async putDragonTigerSeats(tradeDate: string, code: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.dtSeat, 'dragon_tiger_seat', ['trade_date', 'code'], [tradeDate, code], rows,
      ['trade_date', 'code', 'rank_no', 'branch_name', 'buy_amount', 'buy_amount_ratio',
       'sell_amount', 'sell_amount_ratio', 'net_amount', 'side'],
      (r) => `${tradeDate}|${code}|${s(r.branch_name)}`, ttlMs, now);
  }
  async listDragonTigerSeats(tradeDate: string, code: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.dtSeat, 'dragon_tiger_seat', ['trade_date', 'code'], [tradeDate, code], 'rank_no', now);
  }

  // 热股
  async putHotStocks(listType: string, period: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.hotStock, 'hot_stock', ['list_type', 'period'], [listType, period], rows,
      ['list_type', 'period', 'rank_no', 'code', 'name', 'heat', 'rank_change', 'rank_trend'],
      (r) => `${listType}|${period}|${n0(r.rank_no)}`, ttlMs, now);
  }
  async listHotStocks(listType: string, period: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.hotStock, 'hot_stock', ['list_type', 'period'], [listType, period], 'rank_no', now);
  }

  // 异动
  async putAnomalies(eventType: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.anomaly, 'anomaly_event', ['event_type'], [eventType], rows,
      ['event_type', 'code', 'name', 'event_time', 'change_type', 'change_type_label', 'info', 'price', 'change_pct'],
      (r) => `${eventType}|${s(r.code)}|${s(r.event_time)}|${s(r.change_type)}`, ttlMs, now);
  }
  async listAnomalies(eventType: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.anomaly, 'anomaly_event', ['event_type'], [eventType], 'event_time DESC', now);
  }

  // 大盘资金流
  async putMarketFundFlows(rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.marketFlow, 'market_fund_flow', [], [], rows,
      ['trade_date', 'sh_close', 'sh_change_pct', 'sz_close', 'sz_change_pct',
       'main_net_inflow', 'main_inflow_pct', 'super_large_inflow', 'large_inflow',
       'medium_inflow', 'small_inflow'],
      (r) => s(r.trade_date), ttlMs, now);
  }
  async listMarketFundFlows(now = Date.now()): Promise<Row[]> {
    return this.list(mem.marketFlow, 'market_fund_flow', [], [], 'trade_date DESC', now);
  }

  // 板块成分
  async putBoardConstituents(boardType: string, boardCode: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.boardConst, 'board_constituent', ['board_type', 'board_code'], [boardType, boardCode], rows,
      ['board_type', 'board_code', 'code', 'name', 'rank_no', 'price', 'change_pct', 'volume', 'amount', 'turnover_rate', 'pe', 'pb'],
      (r) => `${boardType}|${boardCode}|${s(r.code)}`, ttlMs, now);
  }
  async listBoardConstituents(boardType: string, boardCode: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.boardConst, 'board_constituent', ['board_type', 'board_code'], [boardType, boardCode], 'rank_no', now);
  }

  // 北向汇总/历史/个股
  async putNorthboundSummaries(rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.nbSummary, 'northbound_summary', [], [], rows,
      ['trade_date', 'board_name', 'direction', 'status', 'net_buy_amount', 'net_inflow', 'remain_amount',
       'up_count', 'down_count', 'flat_count', 'index_code', 'index_name', 'index_change_pct'],
      (r) => `${s(r.trade_date)}|${s(r.board_name)}`, ttlMs, now);
  }
  async listNorthboundSummaries(now = Date.now()): Promise<Row[]> {
    return this.list(mem.nbSummary, 'northbound_summary', [], [], 'trade_date, board_name', now);
  }

  async putNorthboundHistory(direction: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.nbHistory, 'northbound_history', ['direction'], [direction], rows,
      ['trade_date', 'direction', 'net_buy_amount', 'buy_amount', 'sell_amount', 'acc_net_buy_amount',
       'net_inflow', 'remain_amount', 'top_stock_code', 'top_stock_name', 'top_stock_change_pct'],
      (r) => `${s(r.trade_date)}|${direction}`, ttlMs, now);
  }
  async listNorthboundHistory(direction: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.nbHistory, 'northbound_history', ['direction'], [direction], 'trade_date DESC', now);
  }

  async putNorthboundIndividuals(symbolKey: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.nbIndividual, 'northbound_individual', ['symbol_key'], [symbolKey], rows,
      ['trade_date', 'symbol_key', 'hold_shares', 'hold_market_value', 'hold_ratio_float',
       'hold_ratio_total', 'close_price', 'change_pct'],
      (r) => `${s(r.trade_date)}|${symbolKey}`, ttlMs, now);
  }
  async listNorthboundIndividuals(symbolKey: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.nbIndividual, 'northbound_individual', ['symbol_key'], [symbolKey], 'trade_date DESC', now);
  }

  // 两融标的
  async putMarginTargets(tradeDate: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.marginTarget, 'margin_target', ['trade_date'], [tradeDate], rows,
      ['trade_date', 'code', 'name', 'fin_balance', 'fin_buy_amount', 'fin_repay_amount',
       'loan_balance', 'loan_sell_volume', 'loan_repay_volume'],
      (r) => `${tradeDate}|${s(r.code)}`, ttlMs, now);
  }
  async listMarginTargets(tradeDate: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.marginTarget, 'margin_target', ['trade_date'], [tradeDate], 'code', now);
  }

  // 大宗
  async putBlockTradeMarket(rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.btMarket, 'block_trade_market', [], [], rows,
      ['trade_date', 'sh_close', 'sh_change_pct', 'total_amount', 'premium_amount', 'premium_ratio',
       'discount_amount', 'discount_ratio'],
      (r) => s(r.trade_date), ttlMs, now);
  }
  async listBlockTradeMarket(now = Date.now()): Promise<Row[]> {
    return this.list(mem.btMarket, 'block_trade_market', [], [], 'trade_date DESC', now);
  }

  async putBlockTradeDaily(tradeDate: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.btDaily, 'block_trade_daily', ['trade_date'], [tradeDate], rows,
      ['trade_date', 'code', 'name', 'change_pct', 'close_price', 'deal_count', 'deal_total_amount',
       'deal_total_volume', 'premium_amount', 'discount_amount'],
      (r) => `${tradeDate}|${s(r.code)}`, ttlMs, now);
  }
  async listBlockTradeDaily(tradeDate: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.btDaily, 'block_trade_daily', ['trade_date'], [tradeDate], 'code', now);
  }

  // 竞价
  async putAuctionSnapshots(tradeDate: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.auction, 'auction_snapshot', ['trade_date'], [tradeDate], rows,
      ['trade_date', 'code', 'name', 'auction_price', 'auction_pct', 'auction_volume', 'auction_amount',
       'auction_unmatched', 'auction_turnover_pct', 'pre_close_price', 'open_price', 'last_price', 'float_market_cap'],
      (r) => `${tradeDate}|${s(r.code)}`, ttlMs, now);
  }
  async listAuctionSnapshots(tradeDate: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.auction, 'auction_snapshot', ['trade_date'], [tradeDate], 'code', now);
  }

  async putShortTermBenchmarks(tradeDate: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.shortTerm, 'short_term_benchmark', ['trade_date'], [tradeDate], rows,
      ['trade_date', 'code', 'name', 'auction_pct', 'tags'],
      (r) => `${tradeDate}|${s(r.code)}`, ttlMs, now);
  }
  async listShortTermBenchmarks(tradeDate: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.shortTerm, 'short_term_benchmark', ['trade_date'], [tradeDate], 'code', now);
  }

  // 基金
  async putFundProfile(symbolKey: string, row: Row, ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.fundProfile, 'fund_profile', [], [], [{ ...row, symbol_key: symbolKey }],
      ['symbol_key', 'ticker', 'fund_name', 'estab_date_ms', 'mgmt_name', 'manager_name'],
      () => symbolKey, ttlMs, now);
  }
  async getFundProfile(symbolKey: string, now = Date.now()): Promise<Row | null> {
    const rows = await this.list(mem.fundProfile, 'fund_profile', ['symbol_key'], [symbolKey], '', now);
    return rows[0] ?? null;
  }

  async putFundHoldings(symbolKey: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.fundHolding, 'fund_holding', ['symbol_key'], [symbolKey], rows,
      ['symbol_key', 'ticker', 'stock_name', 'hold_ratio'],
      (r) => `${symbolKey}|${s(r.ticker)}`, ttlMs, now);
  }
  async listFundHoldings(symbolKey: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.fundHolding, 'fund_holding', ['symbol_key'], [symbolKey], 'ticker', now);
  }

  async putFundNavs(symbolKey: string, rows: Row[], now = Date.now()): Promise<void> {
    const db = await this.db();
    if (!db) {
      for (const [k, r] of mem.fundNav) {
        if (k.startsWith(symbolKey + '|')) mem.fundNav.delete(k);
      }
      for (const r of rows) {
        mem.fundNav.set(`${symbolKey}|${s(r.nav_date)}`, { ...r, symbol_key: symbolKey });
      }
      return;
    }
    await db.execute('DELETE FROM fund_nav WHERE symbol_key = ?', [symbolKey]);
    for (const r of rows) {
      await db.execute(
        `INSERT OR REPLACE INTO fund_nav (symbol_key, nav_date, unit_nav, adj_nav, updated_at)
         VALUES (?,?,?,?,?)`,
        [symbolKey, s(r.nav_date), n(r.unit_nav), n(r.adj_nav), now],
      );
    }
  }
  async listFundNavs(symbolKey: string): Promise<Row[]> {
    const db = await this.db();
    if (!db) {
      return [...mem.fundNav.values()]
        .filter((r) => s(r.symbol_key) === symbolKey)
        .sort((a, b) => s(a.nav_date).localeCompare(s(b.nav_date)));
    }
    const res = await db.execute(
      'SELECT * FROM fund_nav WHERE symbol_key = ? ORDER BY nav_date ASC',
      [symbolKey],
    );
    return (res.rows ?? []).map((r) => ({ ...(r as Record<string, Scalar>) }));
  }

  async putFundDividends(rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.fundDividend, 'fund_dividend', [], [], rows,
      ['fund_code', 'fund_name', 'equity_record_date', 'ex_dividend_date', 'dividend_per_share', 'pay_date', 'dividend_type'],
      (r) => `${s(r.fund_code)}|${s(r.ex_dividend_date)}`, ttlMs, now);
  }
  async listFundDividends(now = Date.now()): Promise<Row[]> {
    return this.list(mem.fundDividend, 'fund_dividend', [], [], 'ex_dividend_date DESC', now);
  }

  async putFundRankHistory(fundCode: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.fundRank, 'fund_rank_history', ['fund_code'], [fundCode], rows,
      ['fund_code', 'fund_name', 'trade_date', 'rank_no', 'total', 'percentile'],
      (r) => `${fundCode}|${s(r.trade_date)}`, ttlMs, now);
  }
  async listFundRankHistory(fundCode: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.fundRank, 'fund_rank_history', ['fund_code'], [fundCode], 'trade_date ASC', now);
  }

  // 筹码
  async putChips(symbolKey: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.chip, 'chip_distribution', ['symbol_key'], [symbolKey], rows,
      ['symbol_key', 'trade_date', 'profit_ratio', 'avg_cost', 'cost90_low', 'cost90_high',
       'concentration90', 'cost70_low', 'cost70_high', 'concentration70'],
      (r) => `${symbolKey}|${s(r.trade_date)}`, ttlMs, now);
  }
  async listChips(symbolKey: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.chip, 'chip_distribution', ['symbol_key'], [symbolKey], 'trade_date ASC', now);
  }

  // 期权
  async putOptionLegs(product: string, contract: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.optionLeg, 'option_leg', ['product', 'contract'], [product, contract], rows,
      ['quote_kind', 'product', 'contract', 'symbol', 'buy_volume', 'buy_price', 'price',
       'ask_price', 'ask_volume', 'open_interest', 'change_amt', 'strike_price'],
      (r) => `${s(r.quote_kind)}|${product}|${contract}|${s(r.symbol)}`, ttlMs, now);
  }
  async listOptionLegs(product: string, contract: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.optionLeg, 'option_leg', ['product', 'contract'], [product, contract], 'quote_kind, strike_price', now);
  }

  async putOptionKlines(kind: string, code: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.optionKline, 'option_kline', ['kind', 'code'], [kind, code], rows,
      ['kind', 'code', 'trade_date', 'open_price', 'high_price', 'low_price', 'close_price', 'volume'],
      (r) => `${kind}|${code}|${s(r.trade_date)}`, ttlMs, now);
  }
  async listOptionKlines(kind: string, code: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.optionKline, 'option_kline', ['kind', 'code'], [kind, code], 'trade_date ASC', now);
  }

  async putOptionCffex(rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.optionCffex, 'option_cffex', [], [], rows,
      ['code', 'name', 'price', 'change_amt', 'change_pct', 'volume', 'amount',
       'open_interest', 'strike_price', 'remain_days', 'prev_settle', 'open_price'],
      (r) => s(r.code), ttlMs, now);
  }
  async listOptionCffex(now = Date.now()): Promise<Row[]> {
    return this.list(mem.optionCffex, 'option_cffex', [], [], 'code', now);
  }

  async putOptionLhb(tradeDate: string, symbol: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.optionLhb, 'option_lhb', ['trade_date', 'symbol'], [tradeDate, symbol], rows,
      ['trade_date', 'symbol', 'target_name', 'trade_type', 'rank_no', 'member_name',
       'buy_volume', 'sell_volume', 'net_buy_volume', 'buy_volume_ratio', 'sell_volume_ratio'],
      (r) => `${tradeDate}|${symbol}|${s(r.member_name)}`, ttlMs, now);
  }
  async listOptionLhb(tradeDate: string, symbol: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.optionLhb, 'option_lhb', ['trade_date', 'symbol'], [tradeDate, symbol], 'rank_no', now);
  }

  // 期货
  async putFuturesKlines(kind: string, code: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.futuresKline, 'futures_kline', ['kind', 'code'], [kind, code], rows,
      ['kind', 'code', 'trade_date', 'name', 'open_price', 'high_price', 'low_price', 'close_price',
       'volume', 'amount', 'change_pct', 'change_amt', 'open_interest'],
      (r) => `${kind}|${code}|${s(r.trade_date)}`, ttlMs, now);
  }
  async listFuturesKlines(kind: string, code: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.futuresKline, 'futures_kline', ['kind', 'code'], [kind, code], 'trade_date ASC', now);
  }

  async putFuturesSpots(rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.futuresSpot, 'futures_spot', [], [], rows,
      ['code', 'name', 'price', 'change_amt', 'change_pct', 'open_price', 'high_price',
       'low_price', 'prev_settle', 'volume', 'open_interest'],
      (r) => s(r.code), ttlMs, now);
  }
  async listFuturesSpots(now = Date.now()): Promise<Row[]> {
    return this.list(mem.futuresSpot, 'futures_spot', [], [], 'code', now);
  }

  async putFuturesInventory(kind: string, code: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.futuresInventory, 'futures_inventory', ['kind', 'code'], [kind, code], rows,
      ['kind', 'code', 'trade_date', 'name', 'inventory', 'change_amt', 'storage_ton', 'storage_ounce'],
      (r) => `${kind}|${code}|${s(r.trade_date)}`, ttlMs, now);
  }
  async listFuturesInventory(kind: string, code: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.futuresInventory, 'futures_inventory', ['kind', 'code'], [kind, code], 'trade_date ASC', now);
  }

  // 指数 / 档案 / 复权
  async putIndexCatalog(tag: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.indexCatalog, 'index_catalog', ['tag'], [tag], rows,
      ['tag', 'code', 'name'],
      (r) => `${tag}|${s(r.code)}`, ttlMs, now);
  }
  async listIndexCatalog(tag: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.indexCatalog, 'index_catalog', ['tag'], [tag], 'code', now);
  }

  async putIndexConstituents(indexCode: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.indexConstituent, 'index_constituent', ['index_code'], [indexCode], rows,
      ['index_code', 'code', 'name'],
      (r) => `${indexCode}|${s(r.code)}`, ttlMs, now);
  }
  async listIndexConstituents(indexCode: string, now = Date.now()): Promise<Row[]> {
    return this.list(mem.indexConstituent, 'index_constituent', ['index_code'], [indexCode], 'code', now);
  }

  async putStockInfo(code: string, row: Row, ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(mem.stockInfo, 'stock_info', [], [], [{ ...row, code }],
      ['code', 'name', 'industry', 'payload'],
      () => code, ttlMs, now);
  }
  async getStockInfo(code: string, now = Date.now()): Promise<Row | null> {
    const rows = await this.list(mem.stockInfo, 'stock_info', ['code'], [code], '', now);
    return rows[0] ?? null;
  }

  async putAdjustmentFactors(symbolKey: string, rows: Row[], now = Date.now()): Promise<void> {
    const db = await this.db();
    if (!db) {
      for (const [k, r] of mem.adjustment) {
        if (k.startsWith(symbolKey + '|')) mem.adjustment.delete(k);
      }
      for (const r of rows) {
        mem.adjustment.set(`${symbolKey}|${n0(r.ex_date_ms)}`, { ...r, symbol_key: symbolKey });
      }
      return;
    }
    await db.execute('DELETE FROM adjustment_factor WHERE symbol_key = ?', [symbolKey]);
    for (const r of rows) {
      await db.execute(
        `INSERT OR REPLACE INTO adjustment_factor
         (symbol_key, ticker, ex_date_ms, dividend_per_share, per_share_bonus, allotment_ratio, allotment_price, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          symbolKey, s(r.ticker), n0(r.ex_date_ms), n(r.dividend_per_share),
          n(r.per_share_bonus), n(r.allotment_ratio), n(r.allotment_price), now,
        ],
      );
    }
  }
  async listAdjustmentFactors(symbolKey: string): Promise<Row[]> {
    const db = await this.db();
    if (!db) {
      return [...mem.adjustment.values()]
        .filter((r) => s(r.symbol_key) === symbolKey)
        .sort((a, b) => n0(a.ex_date_ms) - n0(b.ex_date_ms));
    }
    const res = await db.execute(
      'SELECT * FROM adjustment_factor WHERE symbol_key = ? ORDER BY ex_date_ms ASC',
      [symbolKey],
    );
    return (res.rows ?? []).map((r) => ({ ...(r as Record<string, Scalar>) }));
  }

  /** 只清理 quote_snapshot 过期条目（QuotesCache 专用，不牵连其它表） */
  async pruneQuoteSnapshot(now = Date.now()): Promise<number> {
    const db = await this.db();
    if (!db) {
      let n = 0;
      for (const [k, r] of mem.quote) {
        if (r.expiresAt < now) {
          mem.quote.delete(k);
          n += 1;
        }
      }
      return n;
    }
    const res = await db.execute('DELETE FROM quote_snapshot WHERE expires_at < ?', [now]);
    return res.rowsAffected ?? 0;
  }

  /** 清理全部领域表过期条目 */
  async pruneAllExpired(now = Date.now()): Promise<number> {
    const tables = [
      'quote_snapshot', 'fund_flow_rank', 'limit_stock', 'board_quote',
      'northbound_minute', 'margin_account', 'dragon_tiger_stat',
      'valuation_snapshot', 'financial_statement', 'financial_indicator', 'dividend_detail',
      'ladder_stock', 'dragon_tiger_stock', 'dragon_tiger_institution', 'dragon_tiger_branch',
      'dragon_tiger_seat', 'hot_stock', 'anomaly_event', 'market_fund_flow', 'board_constituent',
      'northbound_summary', 'northbound_history', 'northbound_individual', 'margin_target',
      'block_trade_market', 'block_trade_daily', 'auction_snapshot', 'short_term_benchmark',
      'fund_profile', 'fund_holding', 'fund_dividend', 'fund_rank_history', 'chip_distribution',
      'option_leg', 'option_kline', 'option_cffex', 'option_lhb', 'futures_kline', 'futures_spot',
      'futures_inventory', 'index_catalog', 'index_constituent', 'stock_info',
    ];
    const db = await this.db();
    if (!db) {
      let n = 0;
      for (const map of Object.values(mem)) {
        for (const [k, r] of map as Map<string, { expiresAt?: number; expires_at?: number }>) {
          const exp = r.expiresAt ?? r.expires_at;
          if (typeof exp === 'number' && exp > 0 && exp < now) {
            (map as Map<string, unknown>).delete(k);
            n += 1;
          }
        }
      }
      return n;
    }
    let total = 0;
    for (const table of tables) {
      const res = await db.execute(`DELETE FROM ${table} WHERE expires_at < ?`, [now]);
      total += res.rowsAffected ?? 0;
    }
    return total;
  }

  /** 清理过期（别名） */
  async pruneExpired(now = Date.now()): Promise<number> {
    return this.pruneAllExpired(now);
  }

  /** 测试辅助：清空内存回落 */
  static resetMemory(): void {
    for (const map of Object.values(mem)) map.clear();
  }
}

let _store: DomainCacheStore | null = null;

/** 统一领域缓存单例 */
export function domainCache(): DomainCacheStore {
  if (!_store) _store = new DomainCacheStore();
  return _store;
}

export function resetDomainCache(): void {
  _store = null;
  DomainCacheStore.resetMemory();
}

export type DomainCache = DomainCacheStore;
