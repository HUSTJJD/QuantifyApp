/**
 * DomainCacheStore —— 核心行情领域表读写（SQLite，内存回落）。
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
}
const mem = new Mem();

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

  // ---------- 清理 ----------

  async pruneExpired(now = Date.now()): Promise<number> {
    const db = await this.db();
    if (!db) {
      let n = 0;
      for (const map of [
        mem.quote, mem.fundFlowRank, mem.limitStock, mem.boardQuote,
        mem.nbMinute, mem.marginAccount, mem.dtStat,
      ] as Map<string, { expiresAt: number }>[]) {
        for (const [k, r] of map) {
          if (r.expiresAt < now) {
            map.delete(k);
            n += 1;
          }
        }
      }
      return n;
    }
    let total = 0;
    for (const table of [
      'quote_snapshot', 'fund_flow_rank', 'limit_stock', 'board_quote',
      'northbound_minute', 'margin_account', 'dragon_tiger_stat',
    ]) {
      const res = await db.execute(`DELETE FROM ${table} WHERE expires_at < ?`, [now]);
      total += res.rowsAffected ?? 0;
    }
    return total;
  }

  /** 测试辅助：清空内存回落 */
  static resetMemory(): void {
    mem.quote.clear();
    mem.calendar.clear();
    mem.fundFlow.clear();
    mem.fundFlowRank.clear();
    mem.limitStock.clear();
    mem.boardQuote.clear();
    mem.nbMinute.clear();
    mem.nbHolding.clear();
    mem.marginAccount.clear();
    mem.dtStat.clear();
  }
}

let _store: DomainCacheStore | null = null;
export function domainCache(): DomainCacheStore {
  if (!_store) _store = new DomainCacheStore();
  return _store;
}
export function resetDomainCache(): void {
  _store = null;
  DomainCacheStore.resetMemory();
}
