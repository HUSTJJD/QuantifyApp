/**
 * DomainCacheV6 —— v6 领域表通用读写（财务/龙虎榜/基金/期权/期货/北向明细等）。
 *
 * 通用模式：每表带 expires_at；put 先清旧快照再批量写；list 按 expires_at 过滤。
 * 内存回落用静态 Map（jest / 无原生 SQLite）。
 */
import type { DB, Scalar } from '@op-engineering/op-sqlite';
import { getSqlite } from './connection';

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

const memMaps = {
  valuation: new Map<string, Row>(),
  financialReport: new Map<string, Row>(),
  financialStatement: new Map<string, Row>(),
  financialIndicator: new Map<string, Row>(),
  dividend: new Map<string, Row>(),
  ladder: new Map<string, Row>(),
  dtStock: new Map<string, Row>(),
  dtInst: new Map<string, Row>(),
  dtBranch: new Map<string, Row>(),
  dtSeat: new Map<string, Row>(),
  hotStock: new Map<string, Row>(),
  anomaly: new Map<string, Row>(),
  marketFlow: new Map<string, Row>(),
  boardConst: new Map<string, Row>(),
  nbSummary: new Map<string, Row>(),
  nbHistory: new Map<string, Row>(),
  nbIndividual: new Map<string, Row>(),
  marginTarget: new Map<string, Row>(),
  btMarket: new Map<string, Row>(),
  btDaily: new Map<string, Row>(),
  auction: new Map<string, Row>(),
  shortTerm: new Map<string, Row>(),
  fundProfile: new Map<string, Row>(),
  fundHolding: new Map<string, Row>(),
  fundNav: new Map<string, Row>(),
  fundDividend: new Map<string, Row>(),
  fundRank: new Map<string, Row>(),
  chip: new Map<string, Row>(),
  optionLeg: new Map<string, Row>(),
  optionKline: new Map<string, Row>(),
  optionCffex: new Map<string, Row>(),
  optionLhb: new Map<string, Row>(),
  futuresKline: new Map<string, Row>(),
  futuresSpot: new Map<string, Row>(),
  futuresInventory: new Map<string, Row>(),
  indexCatalog: new Map<string, Row>(),
  indexConstituent: new Map<string, Row>(),
  stockInfo: new Map<string, Row>(),
  adjustment: new Map<string, Row>(),
};

export class DomainCacheV6 {
  private async db(): Promise<DB | null> {
    return getSqlite();
  }

  // ---------- 估值 ----------
  async putValuations(rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    const db = await this.db();
    await replaceSnapshot(db, memMaps.valuation, 'valuation_snapshot', [], [], rows, [
      'symbol_key', 'code', 'exchange', 'name', 'pe_ttm', 'pe_mrq', 'pb_mrq',
      'ps_ttm', 'pcf_ttm', 'timestamp',
    ], (r) => s(r.symbol_key), ttlMs, now);
  }
  async listValuations(symbolKeys: string[], now = Date.now()): Promise<Row[]> {
    const db = await this.db();
    const out: Row[] = [];
    for (const k of symbolKeys) {
      const rows = await listSnapshot(db, memMaps.valuation, 'valuation_snapshot', ['symbol_key'], [k], '', now);
      out.push(...rows);
    }
    return out;
  }

  // ---------- 财务汇总 ----------
  async putFinancialReports(symbolKey: string, rows: Row[], now = Date.now()): Promise<void> {
    const db = await this.db();
    // 无 expires：财务慢变，按 symbol 替换
    if (!db) {
      for (const [k, r] of memMaps.financialReport) {
        if (k.startsWith(symbolKey + '|')) memMaps.financialReport.delete(k);
      }
      for (const r of rows) {
        memMaps.financialReport.set(`${symbolKey}|${n0(r.period_end_ms)}`, r);
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
      return [...memMaps.financialReport.values()]
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
    await this.putList(memMaps.financialStatement, 'financial_statement',
      ['symbol_key', 'statement_type'], [symbolKey, stmtType], rows,
      ['symbol_key', 'statement_type', 'period', 'period_end_ms', 'report_date_ms',
       'fiscal_year', 'fiscal_period', 'currency', 'payload'],
      (r) => `${symbolKey}|${stmtType}|${n0(r.period_end_ms)}`, ttlMs, now);
  }
  async listFinancialStatements(symbolKey: string, stmtType: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.financialStatement, 'financial_statement',
      ['symbol_key', 'statement_type'], [symbolKey, stmtType], 'period_end_ms DESC', now);
  }

  async putFinancialIndicators(symbolKey: string, report: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.financialIndicator, 'financial_indicator',
      ['symbol_key', 'report'], [symbolKey, report], rows,
      ['symbol_key', 'report', 'category', 'index_id', 'value'],
      (r) => `${symbolKey}|${report}|${s(r.index_id)}`, ttlMs, now);
  }
  async listFinancialIndicators(symbolKey: string, report: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.financialIndicator, 'financial_indicator',
      ['symbol_key', 'report'], [symbolKey, report], 'category, index_id', now);
  }

  async putDividendDetails(symbolKey: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.dividend, 'dividend_detail', ['symbol_key'], [symbolKey], rows,
      ['symbol_key', 'code', 'name', 'report_date', 'dividend_pretax', 'dividend_yield',
       'bonus_ratio', 'transfer_ratio', 'ex_dividend_date', 'pay_date'],
      (r) => `${symbolKey}|${s(r.report_date)}`, ttlMs, now);
  }
  async listDividendDetails(symbolKey: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.dividend, 'dividend_detail', ['symbol_key'], [symbolKey], 'report_date DESC', now);
  }

  // 连板天梯
  async putLadder(tradeDate: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.ladder, 'ladder_stock', ['trade_date'], [tradeDate], rows,
      ['trade_date', 'board_key', 'code', 'name', 'board_num', 'seal_nextday', 'sign_level'],
      (r) => `${tradeDate}|${s(r.board_key)}|${s(r.code)}`, ttlMs, now);
  }
  async listLadder(tradeDate: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.ladder, 'ladder_stock', ['trade_date'], [tradeDate], 'board_key, code', now);
  }

  // 龙虎榜 list
  async putDragonTigerStocks(tradeDate: string, boardType: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.dtStock, 'dragon_tiger_stock', ['trade_date', 'board_type'], [tradeDate, boardType], rows,
      ['trade_date', 'board_type', 'code', 'name', 'change_pct', 'buy_value', 'sell_value',
       'net_value', 'net_rate', 'org_net_value', 'hot_money_net_value', 'hot_rank', 'range_days', 'limit_reason'],
      (r) => `${tradeDate}|${boardType}|${s(r.code)}`, ttlMs, now);
  }
  async listDragonTigerStocks(tradeDate: string, boardType: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.dtStock, 'dragon_tiger_stock', ['trade_date', 'board_type'], [tradeDate, boardType], 'code', now);
  }

  async putDragonTigerInstitutions(tradeDate: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.dtInst, 'dragon_tiger_institution', ['trade_date'], [tradeDate], rows,
      ['trade_date', 'code', 'name', 'close_price', 'change_pct', 'buy_org_count', 'sell_org_count',
       'org_buy_amount', 'org_sell_amount', 'org_net_amount'],
      (r) => `${tradeDate}|${s(r.code)}`, ttlMs, now);
  }
  async listDragonTigerInstitutions(tradeDate: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.dtInst, 'dragon_tiger_institution', ['trade_date'], [tradeDate], 'code', now);
  }

  async putDragonTigerBranches(period: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.dtBranch, 'dragon_tiger_branch', ['period'], [period], rows,
      ['period', 'rank_no', 'code', 'name', 'total_buy_amount', 'total_sell_amount', 'buy_count', 'sell_count', 'total_count'],
      (r) => `${period}|${n0(r.rank_no)}`, ttlMs, now);
  }
  async listDragonTigerBranches(period: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.dtBranch, 'dragon_tiger_branch', ['period'], [period], 'rank_no', now);
  }

  async putDragonTigerSeats(tradeDate: string, code: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.dtSeat, 'dragon_tiger_seat', ['trade_date', 'code'], [tradeDate, code], rows,
      ['trade_date', 'code', 'rank_no', 'branch_name', 'buy_amount', 'buy_amount_ratio',
       'sell_amount', 'sell_amount_ratio', 'net_amount', 'side'],
      (r) => `${tradeDate}|${code}|${s(r.branch_name)}`, ttlMs, now);
  }
  async listDragonTigerSeats(tradeDate: string, code: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.dtSeat, 'dragon_tiger_seat', ['trade_date', 'code'], [tradeDate, code], 'rank_no', now);
  }

  // 热股
  async putHotStocks(listType: string, period: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.hotStock, 'hot_stock', ['list_type', 'period'], [listType, period], rows,
      ['list_type', 'period', 'rank_no', 'code', 'name', 'heat', 'rank_change', 'rank_trend'],
      (r) => `${listType}|${period}|${n0(r.rank_no)}`, ttlMs, now);
  }
  async listHotStocks(listType: string, period: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.hotStock, 'hot_stock', ['list_type', 'period'], [listType, period], 'rank_no', now);
  }

  // 异动
  async putAnomalies(eventType: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.anomaly, 'anomaly_event', ['event_type'], [eventType], rows,
      ['event_type', 'code', 'name', 'event_time', 'change_type', 'change_type_label', 'info', 'price', 'change_pct'],
      (r) => `${eventType}|${s(r.code)}|${s(r.event_time)}|${s(r.change_type)}`, ttlMs, now);
  }
  async listAnomalies(eventType: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.anomaly, 'anomaly_event', ['event_type'], [eventType], 'event_time DESC', now);
  }

  // 大盘资金流
  async putMarketFundFlows(rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.marketFlow, 'market_fund_flow', [], [], rows,
      ['trade_date', 'sh_close', 'sh_change_pct', 'sz_close', 'sz_change_pct',
       'main_net_inflow', 'main_inflow_pct', 'super_large_inflow', 'large_inflow',
       'medium_inflow', 'small_inflow'],
      (r) => s(r.trade_date), ttlMs, now);
  }
  async listMarketFundFlows(now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.marketFlow, 'market_fund_flow', [], [], 'trade_date DESC', now);
  }

  // 板块成分
  async putBoardConstituents(boardType: string, boardCode: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.boardConst, 'board_constituent', ['board_type', 'board_code'], [boardType, boardCode], rows,
      ['board_type', 'board_code', 'code', 'name', 'rank_no', 'price', 'change_pct', 'volume', 'amount', 'turnover_rate', 'pe', 'pb'],
      (r) => `${boardType}|${boardCode}|${s(r.code)}`, ttlMs, now);
  }
  async listBoardConstituents(boardType: string, boardCode: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.boardConst, 'board_constituent', ['board_type', 'board_code'], [boardType, boardCode], 'rank_no', now);
  }

  // 北向汇总/历史/个股
  async putNorthboundSummaries(rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.nbSummary, 'northbound_summary', [], [], rows,
      ['trade_date', 'board_name', 'direction', 'status', 'net_buy_amount', 'net_inflow', 'remain_amount',
       'up_count', 'down_count', 'flat_count', 'index_code', 'index_name', 'index_change_pct'],
      (r) => `${s(r.trade_date)}|${s(r.board_name)}`, ttlMs, now);
  }
  async listNorthboundSummaries(now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.nbSummary, 'northbound_summary', [], [], 'trade_date, board_name', now);
  }

  async putNorthboundHistory(direction: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.nbHistory, 'northbound_history', ['direction'], [direction], rows,
      ['trade_date', 'direction', 'net_buy_amount', 'buy_amount', 'sell_amount', 'acc_net_buy_amount',
       'net_inflow', 'remain_amount', 'top_stock_code', 'top_stock_name', 'top_stock_change_pct'],
      (r) => `${s(r.trade_date)}|${direction}`, ttlMs, now);
  }
  async listNorthboundHistory(direction: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.nbHistory, 'northbound_history', ['direction'], [direction], 'trade_date DESC', now);
  }

  async putNorthboundIndividuals(symbolKey: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.nbIndividual, 'northbound_individual', ['symbol_key'], [symbolKey], rows,
      ['trade_date', 'symbol_key', 'hold_shares', 'hold_market_value', 'hold_ratio_float',
       'hold_ratio_total', 'close_price', 'change_pct'],
      (r) => `${s(r.trade_date)}|${symbolKey}`, ttlMs, now);
  }
  async listNorthboundIndividuals(symbolKey: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.nbIndividual, 'northbound_individual', ['symbol_key'], [symbolKey], 'trade_date DESC', now);
  }

  // 两融标的
  async putMarginTargets(tradeDate: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.marginTarget, 'margin_target', ['trade_date'], [tradeDate], rows,
      ['trade_date', 'code', 'name', 'fin_balance', 'fin_buy_amount', 'fin_repay_amount',
       'loan_balance', 'loan_sell_volume', 'loan_repay_volume'],
      (r) => `${tradeDate}|${s(r.code)}`, ttlMs, now);
  }
  async listMarginTargets(tradeDate: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.marginTarget, 'margin_target', ['trade_date'], [tradeDate], 'code', now);
  }

  // 大宗
  async putBlockTradeMarket(rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.btMarket, 'block_trade_market', [], [], rows,
      ['trade_date', 'sh_close', 'sh_change_pct', 'total_amount', 'premium_amount', 'premium_ratio',
       'discount_amount', 'discount_ratio'],
      (r) => s(r.trade_date), ttlMs, now);
  }
  async listBlockTradeMarket(now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.btMarket, 'block_trade_market', [], [], 'trade_date DESC', now);
  }

  async putBlockTradeDaily(tradeDate: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.btDaily, 'block_trade_daily', ['trade_date'], [tradeDate], rows,
      ['trade_date', 'code', 'name', 'change_pct', 'close_price', 'deal_count', 'deal_total_amount',
       'deal_total_volume', 'premium_amount', 'discount_amount'],
      (r) => `${tradeDate}|${s(r.code)}`, ttlMs, now);
  }
  async listBlockTradeDaily(tradeDate: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.btDaily, 'block_trade_daily', ['trade_date'], [tradeDate], 'code', now);
  }

  // 竞价
  async putAuctionSnapshots(tradeDate: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.auction, 'auction_snapshot', ['trade_date'], [tradeDate], rows,
      ['trade_date', 'code', 'name', 'auction_price', 'auction_pct', 'auction_volume', 'auction_amount',
       'auction_unmatched', 'auction_turnover_pct', 'pre_close_price', 'open_price', 'last_price', 'float_market_cap'],
      (r) => `${tradeDate}|${s(r.code)}`, ttlMs, now);
  }
  async listAuctionSnapshots(tradeDate: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.auction, 'auction_snapshot', ['trade_date'], [tradeDate], 'code', now);
  }

  async putShortTermBenchmarks(tradeDate: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.shortTerm, 'short_term_benchmark', ['trade_date'], [tradeDate], rows,
      ['trade_date', 'code', 'name', 'auction_pct', 'tags'],
      (r) => `${tradeDate}|${s(r.code)}`, ttlMs, now);
  }
  async listShortTermBenchmarks(tradeDate: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.shortTerm, 'short_term_benchmark', ['trade_date'], [tradeDate], 'code', now);
  }

  // 基金
  async putFundProfile(symbolKey: string, row: Row, ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.fundProfile, 'fund_profile', [], [], [{ ...row, symbol_key: symbolKey }],
      ['symbol_key', 'ticker', 'fund_name', 'estab_date_ms', 'mgmt_name', 'manager_name'],
      () => symbolKey, ttlMs, now);
  }
  async getFundProfile(symbolKey: string, now = Date.now()): Promise<Row | null> {
    const rows = await this.list(memMaps.fundProfile, 'fund_profile', ['symbol_key'], [symbolKey], '', now);
    return rows[0] ?? null;
  }

  async putFundHoldings(symbolKey: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.fundHolding, 'fund_holding', ['symbol_key'], [symbolKey], rows,
      ['symbol_key', 'ticker', 'stock_name', 'hold_ratio'],
      (r) => `${symbolKey}|${s(r.ticker)}`, ttlMs, now);
  }
  async listFundHoldings(symbolKey: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.fundHolding, 'fund_holding', ['symbol_key'], [symbolKey], 'ticker', now);
  }

  async putFundNavs(symbolKey: string, rows: Row[], now = Date.now()): Promise<void> {
    const db = await this.db();
    if (!db) {
      for (const [k, r] of memMaps.fundNav) {
        if (k.startsWith(symbolKey + '|')) memMaps.fundNav.delete(k);
      }
      for (const r of rows) {
        memMaps.fundNav.set(`${symbolKey}|${s(r.nav_date)}`, { ...r, symbol_key: symbolKey });
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
      return [...memMaps.fundNav.values()]
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
    await this.putList(memMaps.fundDividend, 'fund_dividend', [], [], rows,
      ['fund_code', 'fund_name', 'equity_record_date', 'ex_dividend_date', 'dividend_per_share', 'pay_date', 'dividend_type'],
      (r) => `${s(r.fund_code)}|${s(r.ex_dividend_date)}`, ttlMs, now);
  }
  async listFundDividends(now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.fundDividend, 'fund_dividend', [], [], 'ex_dividend_date DESC', now);
  }

  async putFundRankHistory(fundCode: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.fundRank, 'fund_rank_history', ['fund_code'], [fundCode], rows,
      ['fund_code', 'fund_name', 'trade_date', 'rank_no', 'total', 'percentile'],
      (r) => `${fundCode}|${s(r.trade_date)}`, ttlMs, now);
  }
  async listFundRankHistory(fundCode: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.fundRank, 'fund_rank_history', ['fund_code'], [fundCode], 'trade_date ASC', now);
  }

  // 筹码
  async putChips(symbolKey: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.chip, 'chip_distribution', ['symbol_key'], [symbolKey], rows,
      ['symbol_key', 'trade_date', 'profit_ratio', 'avg_cost', 'cost90_low', 'cost90_high',
       'concentration90', 'cost70_low', 'cost70_high', 'concentration70'],
      (r) => `${symbolKey}|${s(r.trade_date)}`, ttlMs, now);
  }
  async listChips(symbolKey: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.chip, 'chip_distribution', ['symbol_key'], [symbolKey], 'trade_date ASC', now);
  }

  // 期权
  async putOptionLegs(product: string, contract: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.optionLeg, 'option_leg', ['product', 'contract'], [product, contract], rows,
      ['quote_kind', 'product', 'contract', 'symbol', 'buy_volume', 'buy_price', 'price',
       'ask_price', 'ask_volume', 'open_interest', 'change_amt', 'strike_price'],
      (r) => `${s(r.quote_kind)}|${product}|${contract}|${s(r.symbol)}`, ttlMs, now);
  }
  async listOptionLegs(product: string, contract: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.optionLeg, 'option_leg', ['product', 'contract'], [product, contract], 'quote_kind, strike_price', now);
  }

  async putOptionKlines(kind: string, code: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.optionKline, 'option_kline', ['kind', 'code'], [kind, code], rows,
      ['kind', 'code', 'trade_date', 'open_price', 'high_price', 'low_price', 'close_price', 'volume'],
      (r) => `${kind}|${code}|${s(r.trade_date)}`, ttlMs, now);
  }
  async listOptionKlines(kind: string, code: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.optionKline, 'option_kline', ['kind', 'code'], [kind, code], 'trade_date ASC', now);
  }

  async putOptionCffex(rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.optionCffex, 'option_cffex', [], [], rows,
      ['code', 'name', 'price', 'change_amt', 'change_pct', 'volume', 'amount',
       'open_interest', 'strike_price', 'remain_days', 'prev_settle', 'open_price'],
      (r) => s(r.code), ttlMs, now);
  }
  async listOptionCffex(now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.optionCffex, 'option_cffex', [], [], 'code', now);
  }

  async putOptionLhb(tradeDate: string, symbol: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.optionLhb, 'option_lhb', ['trade_date', 'symbol'], [tradeDate, symbol], rows,
      ['trade_date', 'symbol', 'target_name', 'trade_type', 'rank_no', 'member_name',
       'buy_volume', 'sell_volume', 'net_buy_volume', 'buy_volume_ratio', 'sell_volume_ratio'],
      (r) => `${tradeDate}|${symbol}|${s(r.member_name)}`, ttlMs, now);
  }
  async listOptionLhb(tradeDate: string, symbol: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.optionLhb, 'option_lhb', ['trade_date', 'symbol'], [tradeDate, symbol], 'rank_no', now);
  }

  // 期货
  async putFuturesKlines(kind: string, code: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.futuresKline, 'futures_kline', ['kind', 'code'], [kind, code], rows,
      ['kind', 'code', 'trade_date', 'name', 'open_price', 'high_price', 'low_price', 'close_price',
       'volume', 'amount', 'change_pct', 'change_amt', 'open_interest'],
      (r) => `${kind}|${code}|${s(r.trade_date)}`, ttlMs, now);
  }
  async listFuturesKlines(kind: string, code: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.futuresKline, 'futures_kline', ['kind', 'code'], [kind, code], 'trade_date ASC', now);
  }

  async putFuturesSpots(rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.futuresSpot, 'futures_spot', [], [], rows,
      ['code', 'name', 'price', 'change_amt', 'change_pct', 'open_price', 'high_price',
       'low_price', 'prev_settle', 'volume', 'open_interest'],
      (r) => s(r.code), ttlMs, now);
  }
  async listFuturesSpots(now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.futuresSpot, 'futures_spot', [], [], 'code', now);
  }

  async putFuturesInventory(kind: string, code: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.futuresInventory, 'futures_inventory', ['kind', 'code'], [kind, code], rows,
      ['kind', 'code', 'trade_date', 'name', 'inventory', 'change_amt', 'storage_ton', 'storage_ounce'],
      (r) => `${kind}|${code}|${s(r.trade_date)}`, ttlMs, now);
  }
  async listFuturesInventory(kind: string, code: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.futuresInventory, 'futures_inventory', ['kind', 'code'], [kind, code], 'trade_date ASC', now);
  }

  // 指数 / 档案 / 复权
  async putIndexCatalog(tag: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.indexCatalog, 'index_catalog', ['tag'], [tag], rows,
      ['tag', 'code', 'name'],
      (r) => `${tag}|${s(r.code)}`, ttlMs, now);
  }
  async listIndexCatalog(tag: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.indexCatalog, 'index_catalog', ['tag'], [tag], 'code', now);
  }

  async putIndexConstituents(indexCode: string, rows: Row[], ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.indexConstituent, 'index_constituent', ['index_code'], [indexCode], rows,
      ['index_code', 'code', 'name'],
      (r) => `${indexCode}|${s(r.code)}`, ttlMs, now);
  }
  async listIndexConstituents(indexCode: string, now = Date.now()): Promise<Row[]> {
    return this.list(memMaps.indexConstituent, 'index_constituent', ['index_code'], [indexCode], 'code', now);
  }

  async putStockInfo(code: string, row: Row, ttlMs: number, now = Date.now()): Promise<void> {
    await this.putList(memMaps.stockInfo, 'stock_info', [], [], [{ ...row, code }],
      ['code', 'name', 'industry', 'payload'],
      () => code, ttlMs, now);
  }
  async getStockInfo(code: string, now = Date.now()): Promise<Row | null> {
    const rows = await this.list(memMaps.stockInfo, 'stock_info', ['code'], [code], '', now);
    return rows[0] ?? null;
  }

  async putAdjustmentFactors(symbolKey: string, rows: Row[], now = Date.now()): Promise<void> {
    const db = await this.db();
    if (!db) {
      for (const [k, r] of memMaps.adjustment) {
        if (k.startsWith(symbolKey + '|')) memMaps.adjustment.delete(k);
      }
      for (const r of rows) {
        memMaps.adjustment.set(`${symbolKey}|${n0(r.ex_date_ms)}`, { ...r, symbol_key: symbolKey });
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
      return [...memMaps.adjustment.values()]
        .filter((r) => s(r.symbol_key) === symbolKey)
        .sort((a, b) => n0(a.ex_date_ms) - n0(b.ex_date_ms));
    }
    const res = await db.execute(
      'SELECT * FROM adjustment_factor WHERE symbol_key = ? ORDER BY ex_date_ms ASC',
      [symbolKey],
    );
    return (res.rows ?? []).map((r) => ({ ...(r as Record<string, Scalar>) }));
  }

  async pruneExpired(now = Date.now()): Promise<number> {
    const db = await this.db();
    const tables = [
      'valuation_snapshot', 'financial_statement', 'financial_indicator', 'dividend_detail',
      'ladder_stock', 'dragon_tiger_stock', 'dragon_tiger_institution', 'dragon_tiger_branch',
      'dragon_tiger_seat', 'hot_stock', 'anomaly_event', 'market_fund_flow', 'board_constituent',
      'northbound_summary', 'northbound_history', 'northbound_individual', 'margin_target',
      'block_trade_market', 'block_trade_daily', 'auction_snapshot', 'short_term_benchmark',
      'fund_profile', 'fund_holding', 'fund_dividend', 'fund_rank_history', 'chip_distribution',
      'option_leg', 'option_kline', 'option_cffex', 'option_lhb', 'futures_kline', 'futures_spot',
      'futures_inventory', 'index_catalog', 'index_constituent', 'stock_info',
    ];
    if (!db) {
      let n = 0;
      for (const map of Object.values(memMaps)) {
        for (const [k, r] of map) {
          if (n0(r.expires_at) > 0 && n0(r.expires_at) < now) {
            map.delete(k);
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

  static resetMemory(): void {
    for (const map of Object.values(memMaps)) map.clear();
  }
}

let _v6: DomainCacheV6 | null = null;
export function domainCacheV6(): DomainCacheV6 {
  if (!_v6) _v6 = new DomainCacheV6();
  return _v6;
}
export function resetDomainCacheV6(): void {
  _v6 = null;
  DomainCacheV6.resetMemory();
}
