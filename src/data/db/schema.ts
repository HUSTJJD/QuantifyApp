/**
 * 本地 SQLite 库 Schema：集中建表 DDL。
 *
 * 无历史库、无迁移：每次启动幂等执行 CREATE TABLE IF NOT EXISTS。
 * 表结构变更直接改 DDL，开发期可删库重建。
 */
import type { DB } from '@op-engineering/op-sqlite';

/** 本地库文件名 */
export const SQLITE_DB_NAME = 'quantify.db';

/** 库文件位置（op-sqlite 'default' = 应用沙盒内） */
export const SQLITE_DB_LOCATION = 'default';

/** 建表语句（按依赖顺序，全部幂等；meta 必须第一） */
export const DDL_STATEMENTS: readonly string[] = [
  // 版本与元信息
  `CREATE TABLE IF NOT EXISTS meta (
  key   TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (key)
)`,

  // K 线主表：主键 (symbol, period, ts) 支撑行级 upsert；覆盖索引支撑「取某标的某周期」
  `CREATE TABLE IF NOT EXISTS kline (
  symbol    TEXT NOT NULL,
  period    TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  open      REAL NOT NULL,
  high      REAL NOT NULL,
  low       REAL NOT NULL,
  close     REAL NOT NULL,
  volume    REAL NOT NULL DEFAULT 0,
  amount    REAL NOT NULL DEFAULT 0,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (symbol, period, ts)
)`,
  `CREATE INDEX IF NOT EXISTS idx_kline_sym_period ON kline(symbol, period, ts)`,

  // 全市场标的库（增量同步底座）
  `CREATE TABLE IF NOT EXISTS tickers (
  symbol    TEXT NOT NULL,
  name      TEXT NOT NULL DEFAULT '',
  exchange  TEXT NOT NULL,
  assetType TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (symbol)
)`,

  // 同步进度（每标的每周期最近一次成功同步的写入时间）
  `CREATE TABLE IF NOT EXISTS sync_state (
  symbol     TEXT NOT NULL,
  period     TEXT NOT NULL,
  lastSyncMs INTEGER NOT NULL,
  PRIMARY KEY (symbol, period)
)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_state_period ON sync_state(period, lastSyncMs)`,

  // 复权因子事件（本地复权计算底座；与不复权 K 线配套存储）
  `CREATE TABLE IF NOT EXISTS adjustment_factors (
  symbol           TEXT NOT NULL,
  exDateMs         INTEGER NOT NULL,
  dividendPerShare REAL,
  perShareBonus    REAL,
  allotmentRatio   REAL,
  allotmentPrice   REAL,
  PRIMARY KEY (symbol, exDateMs)
)`,

  /* ---------------- 用户数据（原 AsyncStorage 迁移而来） ---------------- */

  // 自选（扁平列表，sort 保序）
  `CREATE TABLE IF NOT EXISTS watchlist (
  symbol   TEXT NOT NULL,
  code     TEXT NOT NULL,
  exchange TEXT NOT NULL,
  name     TEXT NOT NULL DEFAULT '',
  sort     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol)
)`,

  // 自选分组（kind/rule 支持动态分组：scan/strategy/condition）
  `CREATE TABLE IF NOT EXISTS watchlist_group (
  id   TEXT NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'static',
  rule TEXT,
  PRIMARY KEY (id)
)`,

  // 分组内标的（组内按 sort 保序，同一标的可属于多个分组）
  `CREATE TABLE IF NOT EXISTS watchlist_group_item (
  group_id TEXT NOT NULL,
  symbol   TEXT NOT NULL,
  code     TEXT NOT NULL,
  exchange TEXT NOT NULL,
  name     TEXT NOT NULL DEFAULT '',
  sort     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, symbol)
)`,

  // 持仓
  `CREATE TABLE IF NOT EXISTS holding (
  symbol     TEXT NOT NULL,
  code       TEXT NOT NULL,
  exchange   TEXT NOT NULL,
  shares     REAL NOT NULL,
  cost_price REAL NOT NULL,
  PRIMARY KEY (symbol)
)`,

  // 资产快照（总资产时间序列）
  `CREATE TABLE IF NOT EXISTS asset_snapshot (
  ts    INTEGER NOT NULL,
  total REAL NOT NULL,
  PRIMARY KEY (ts)
)`,

  // 异动历史（payload 存完整事件 JSON，时间倒序查询）
  `CREATE TABLE IF NOT EXISTS alert_event (
  payload   TEXT NOT NULL,
  saved_at  INTEGER NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_alert_event_saved ON alert_event(saved_at DESC)`,

  /* ---------------- 核心行情领域表（禁止整包 JSON） ----------------
   * 原则：能按列建模的一律建表；复权价由「不复权价 + 复权因子」合成，
   * 不把「已复权 K 线」当独立缓存整包落盘。
   * method_cache 仅兜底「源透传、无稳定列结构」的响应，不承载核心行情。
   */

  // 最新行情快照（getQuotes / getIndexQuotes / getFundMarketSnapshot）
  `CREATE TABLE IF NOT EXISTS quote_snapshot (
  symbol_key   TEXT NOT NULL,
  code         TEXT NOT NULL,
  exchange     TEXT NOT NULL,
  last_price   REAL NOT NULL,
  prev_close   REAL NOT NULL,
  open_price   REAL NOT NULL,
  high_price   REAL NOT NULL,
  low_price    REAL NOT NULL,
  volume       REAL NOT NULL DEFAULT 0,
  amount       REAL NOT NULL DEFAULT 0,
  change_pct   REAL,
  change_amt   REAL,
  updated_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  PRIMARY KEY (symbol_key)
)`,
  `CREATE INDEX IF NOT EXISTS idx_quote_snapshot_expires ON quote_snapshot(expires_at)`,

  // 交易日历（getTradingDays / isTradingDay / next / prev）
  `CREATE TABLE IF NOT EXISTS trading_calendar (
  date        TEXT NOT NULL,
  date_ms     INTEGER NOT NULL,
  is_trading  INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (date)
)`,
  `CREATE INDEX IF NOT EXISTS idx_trading_calendar_date ON trading_calendar(date_ms)`,

  // 个股主力资金流历史（getMainForce / getSectorFundFlowHistory）
  `CREATE TABLE IF NOT EXISTS fund_flow (
  symbol_key       TEXT NOT NULL,
  code             TEXT NOT NULL,
  exchange         TEXT NOT NULL,
  trade_date       TEXT NOT NULL,
  close_price      REAL,
  change_pct       REAL,
  main_net_inflow  REAL,
  main_inflow_pct  REAL,
  super_large_inflow REAL,
  large_inflow     REAL,
  medium_inflow    REAL,
  small_inflow     REAL,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (symbol_key, trade_date)
)`,
  `CREATE INDEX IF NOT EXISTS idx_fund_flow_date ON fund_flow(trade_date DESC)`,

  // 资金流排行快照（getStockFundsFlowing / getStockIndustryFundsFlowing）
  `CREATE TABLE IF NOT EXISTS fund_flow_rank (
  rank_type   TEXT NOT NULL,  -- stock | industry | concept | region
  period      TEXT NOT NULL,  -- today | 3day | 5day | 10day
  rank_no     INTEGER NOT NULL,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  exchange    TEXT NOT NULL DEFAULT '',
  price       REAL,
  change_pct  REAL,
  main_net_inflow REAL,
  main_inflow_pct REAL,
  top_stock_code  TEXT,
  top_stock_name  TEXT,
  snapshot_at INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  PRIMARY KEY (rank_type, period, rank_no)
)`,
  `CREATE INDEX IF NOT EXISTS idx_fund_flow_rank_expires ON fund_flow_rank(expires_at)`,

  // 涨跌停/炸板池（getLimitUpPool / getLimitDownPool / getLimitBreakPool）
  `CREATE TABLE IF NOT EXISTS limit_stock (
  pool_type    TEXT NOT NULL,  -- up | down | break
  trade_date   TEXT NOT NULL,
  code         TEXT NOT NULL,
  exchange     TEXT NOT NULL DEFAULT '',
  name         TEXT NOT NULL,
  last_price   REAL,
  change_pct   REAL,
  board_days   INTEGER,
  seal_money   REAL,
  first_limit_time TEXT,
  last_limit_time  TEXT,
  turnover_pct REAL,
  open_times   INTEGER,
  snapshot_at  INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  PRIMARY KEY (pool_type, trade_date, code)
)`,
  `CREATE INDEX IF NOT EXISTS idx_limit_stock_expires ON limit_stock(expires_at)`,

  // 板块行情榜（getStockIndustryBoard / getConceptBoards）
  `CREATE TABLE IF NOT EXISTS board_quote (
  board_type   TEXT NOT NULL,  -- industry | concept
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  rank_no      INTEGER,
  price        REAL,
  change_pct   REAL,
  total_market_cap REAL,
  turnover_rate REAL,
  rise_count   INTEGER,
  fall_count   INTEGER,
  leading_stock TEXT,
  snapshot_at  INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  PRIMARY KEY (board_type, code)
)`,
  `CREATE INDEX IF NOT EXISTS idx_board_quote_expires ON board_quote(expires_at)`,

  // 北向资金分钟流（getNorthboundMinute）
  `CREATE TABLE IF NOT EXISTS northbound_minute (
  trade_date   TEXT NOT NULL,
  trade_time   TEXT NOT NULL,
  direction    TEXT NOT NULL,  -- north | south
  sh_net_inflow REAL,
  sz_net_inflow REAL,
  total_net_inflow REAL,
  snapshot_at  INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  PRIMARY KEY (trade_date, trade_time, direction)
)`,
  `CREATE INDEX IF NOT EXISTS idx_nb_minute_expires ON northbound_minute(expires_at)`,

  // 北向持股排行（getNorthboundHoldingRank）
  `CREATE TABLE IF NOT EXISTS northbound_holding (
  trade_date   TEXT NOT NULL,
  market       TEXT NOT NULL,
  period       TEXT NOT NULL,
  rank_no      INTEGER NOT NULL,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  close_price  REAL,
  change_pct   REAL,
  hold_shares  REAL,
  hold_market_value REAL,
  hold_ratio_float REAL,
  hold_ratio_total REAL,
  add_shares   REAL,
  add_market_value REAL,
  sector       TEXT,
  snapshot_at  INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  PRIMARY KEY (trade_date, market, period, rank_no)
)`,
  `CREATE INDEX IF NOT EXISTS idx_nb_holding_expires ON northbound_holding(expires_at)`,

  // 两融账户统计（getMarginAccountInfo）
  `CREATE TABLE IF NOT EXISTS margin_account (
  trade_date   TEXT NOT NULL,
  fin_balance  REAL,
  loan_balance REAL,
  fin_buy_amount REAL,
  loan_sell_amount REAL,
  investor_count INTEGER,
  liability_investor_count INTEGER,
  total_guarantee REAL,
  avg_guarantee_ratio REAL,
  snapshot_at  INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  PRIMARY KEY (trade_date)
)`,
  `CREATE INDEX IF NOT EXISTS idx_margin_account_expires ON margin_account(expires_at)`,

  // 龙虎榜个股上榜统计（getDragonTigerStockStats）
  `CREATE TABLE IF NOT EXISTS dragon_tiger_stat (
  period       TEXT NOT NULL,  -- 1month | 3month | 6month | 1year
  rank_no      INTEGER NOT NULL,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  latest_date  TEXT,
  close_price  REAL,
  change_pct   REAL,
  list_count   INTEGER,
  total_buy_amount REAL,
  total_sell_amount REAL,
  total_net_amount REAL,
  snapshot_at  INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  PRIMARY KEY (period, rank_no)
)`,
  `CREATE INDEX IF NOT EXISTS idx_dt_stat_expires ON dragon_tiger_stat(expires_at)`,

  /* ---------------- v6：长期有价值数据全部独立建表 ---------------- */

  // 估值快照
  `CREATE TABLE IF NOT EXISTS valuation_snapshot (
  symbol_key TEXT NOT NULL,
  code       TEXT NOT NULL,
  exchange   TEXT NOT NULL,
  name       TEXT,
  pe_ttm     REAL,
  pe_mrq     REAL,
  pb_mrq     REAL,
  ps_ttm     REAL,
  pcf_ttm    REAL,
  timestamp  INTEGER,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (symbol_key)
)`,
  `CREATE INDEX IF NOT EXISTS idx_val_snapshot_expires ON valuation_snapshot(expires_at)`,

  // 财务汇总（getFinancials：三表按报告期合并）
  `CREATE TABLE IF NOT EXISTS financial_report (
  symbol_key TEXT NOT NULL,
  code       TEXT NOT NULL,
  exchange   TEXT NOT NULL,
  period     TEXT NOT NULL,
  period_end_ms INTEGER NOT NULL,
  basic_eps  REAL,
  operating_income REAL,
  operating_costs REAL,
  net_profit REAL,
  parent_holder_net_profit REAL,
  total_assets REAL,
  holder_equity_total REAL,
  operating_cash_flow REAL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (symbol_key, period_end_ms)
)`,
  `CREATE INDEX IF NOT EXISTS idx_fin_report_period ON financial_report(period_end_ms DESC)`,

  // 三表统一（income/balance/cash_flow 用 statement_type 区分）
  `CREATE TABLE IF NOT EXISTS financial_statement (
  symbol_key TEXT NOT NULL,
  statement_type TEXT NOT NULL,  -- income | balance | cash_flow
  period     TEXT NOT NULL,
  period_end_ms INTEGER NOT NULL,
  report_date_ms INTEGER,
  fiscal_year INTEGER,
  fiscal_period TEXT,
  currency   TEXT,
  payload    TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (symbol_key, statement_type, period_end_ms)
)`,
  `CREATE INDEX IF NOT EXISTS idx_fin_stmt_expires ON financial_statement(expires_at)`,

  // 财务指标
  `CREATE TABLE IF NOT EXISTS financial_indicator (
  symbol_key TEXT NOT NULL,
  report     TEXT NOT NULL,
  category   TEXT NOT NULL,
  index_id   TEXT NOT NULL,
  value      TEXT,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (symbol_key, report, index_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_fin_ind_expires ON financial_indicator(expires_at)`,

  // 分红送配明细
  `CREATE TABLE IF NOT EXISTS dividend_detail (
  symbol_key TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  report_date TEXT,
  dividend_pretax REAL,
  dividend_yield REAL,
  bonus_ratio REAL,
  transfer_ratio REAL,
  ex_dividend_date TEXT,
  pay_date   TEXT,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (symbol_key, report_date)
)`,
  `CREATE INDEX IF NOT EXISTS idx_div_detail_expires ON dividend_detail(expires_at)`,

  // 连板天梯（day + board_key + stock）
  `CREATE TABLE IF NOT EXISTS ladder_stock (
  trade_date TEXT NOT NULL,
  board_key  TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  board_num  INTEGER,
  seal_nextday INTEGER,
  sign_level INTEGER,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (trade_date, board_key, code)
)`,
  `CREATE INDEX IF NOT EXISTS idx_ladder_expires ON ladder_stock(expires_at)`,

  // 龙虎榜 list 股票项
  `CREATE TABLE IF NOT EXISTS dragon_tiger_stock (
  trade_date TEXT NOT NULL,
  board_type TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  change_pct REAL,
  buy_value  REAL,
  sell_value REAL,
  net_value  REAL,
  net_rate   REAL,
  org_net_value REAL,
  hot_money_net_value REAL,
  hot_rank   INTEGER,
  range_days INTEGER,
  limit_reason TEXT,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (trade_date, board_type, code)
)`,
  `CREATE INDEX IF NOT EXISTS idx_dt_stock_expires ON dragon_tiger_stock(expires_at)`,

  // 龙虎榜机构
  `CREATE TABLE IF NOT EXISTS dragon_tiger_institution (
  trade_date TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  close_price REAL,
  change_pct REAL,
  buy_org_count INTEGER,
  sell_org_count INTEGER,
  org_buy_amount REAL,
  org_sell_amount REAL,
  org_net_amount REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (trade_date, code)
)`,
  `CREATE INDEX IF NOT EXISTS idx_dt_inst_expires ON dragon_tiger_institution(expires_at)`,

  // 龙虎榜营业部排行
  `CREATE TABLE IF NOT EXISTS dragon_tiger_branch (
  period     TEXT NOT NULL,
  rank_no    INTEGER NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  total_buy_amount REAL,
  total_sell_amount REAL,
  buy_count  INTEGER,
  sell_count INTEGER,
  total_count INTEGER,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (period, rank_no)
)`,
  `CREATE INDEX IF NOT EXISTS idx_dt_branch_expires ON dragon_tiger_branch(expires_at)`,

  // 龙虎榜席位明细
  `CREATE TABLE IF NOT EXISTS dragon_tiger_seat (
  trade_date TEXT NOT NULL,
  code       TEXT NOT NULL,
  rank_no    INTEGER,
  branch_name TEXT NOT NULL,
  buy_amount REAL,
  buy_amount_ratio REAL,
  sell_amount REAL,
  sell_amount_ratio REAL,
  net_amount REAL,
  side       TEXT,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (trade_date, code, branch_name)
)`,
  `CREATE INDEX IF NOT EXISTS idx_dt_seat_expires ON dragon_tiger_seat(expires_at)`,

  // 热股榜 / 飙升榜
  `CREATE TABLE IF NOT EXISTS hot_stock (
  list_type  TEXT NOT NULL,  -- hot | skyrocket
  period     TEXT NOT NULL,
  rank_no    INTEGER NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  heat       REAL,
  rank_change INTEGER,
  rank_trend TEXT,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (list_type, period, rank_no)
)`,
  `CREATE INDEX IF NOT EXISTS idx_hot_stock_expires ON hot_stock(expires_at)`,

  // 异动事件
  `CREATE TABLE IF NOT EXISTS anomaly_event (
  event_type TEXT NOT NULL,  -- list | stock_change | individual | surge
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  event_time TEXT,
  change_type TEXT,
  change_type_label TEXT,
  info       TEXT,
  price      REAL,
  change_pct REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (event_type, code, event_time, change_type)
)`,
  `CREATE INDEX IF NOT EXISTS idx_anomaly_expires ON anomaly_event(expires_at)`,

  // 大盘资金流
  `CREATE TABLE IF NOT EXISTS market_fund_flow (
  trade_date TEXT NOT NULL,
  sh_close   REAL,
  sh_change_pct REAL,
  sz_close   REAL,
  sz_change_pct REAL,
  main_net_inflow REAL,
  main_inflow_pct REAL,
  super_large_inflow REAL,
  large_inflow REAL,
  medium_inflow REAL,
  small_inflow REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (trade_date)
)`,
  `CREATE INDEX IF NOT EXISTS idx_mkt_flow_expires ON market_fund_flow(expires_at)`,

  // 板块成分
  `CREATE TABLE IF NOT EXISTS board_constituent (
  board_type TEXT NOT NULL,  -- industry | concept
  board_code TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  rank_no    INTEGER,
  price      REAL,
  change_pct REAL,
  volume     REAL,
  amount     REAL,
  turnover_rate REAL,
  pe         REAL,
  pb         REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (board_type, board_code, code)
)`,
  `CREATE INDEX IF NOT EXISTS idx_board_const_expires ON board_constituent(expires_at)`,

  // 北向汇总
  `CREATE TABLE IF NOT EXISTS northbound_summary (
  trade_date TEXT NOT NULL,
  board_name TEXT NOT NULL,
  direction  TEXT NOT NULL,
  status     TEXT,
  net_buy_amount REAL,
  net_inflow REAL,
  remain_amount REAL,
  up_count   INTEGER,
  down_count INTEGER,
  flat_count INTEGER,
  index_code TEXT,
  index_name TEXT,
  index_change_pct REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (trade_date, board_name)
)`,
  `CREATE INDEX IF NOT EXISTS idx_nb_sum_expires ON northbound_summary(expires_at)`,

  // 北向历史
  `CREATE TABLE IF NOT EXISTS northbound_history (
  trade_date TEXT NOT NULL,
  direction  TEXT NOT NULL,
  net_buy_amount REAL,
  buy_amount REAL,
  sell_amount REAL,
  acc_net_buy_amount REAL,
  net_inflow REAL,
  remain_amount REAL,
  top_stock_code TEXT,
  top_stock_name TEXT,
  top_stock_change_pct REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (trade_date, direction)
)`,
  `CREATE INDEX IF NOT EXISTS idx_nb_hist_expires ON northbound_history(expires_at)`,

  // 个股北向持仓
  `CREATE TABLE IF NOT EXISTS northbound_individual (
  trade_date TEXT NOT NULL,
  symbol_key TEXT NOT NULL,
  hold_shares REAL,
  hold_market_value REAL,
  hold_ratio_float REAL,
  hold_ratio_total REAL,
  close_price REAL,
  change_pct REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (trade_date, symbol_key)
)`,
  `CREATE INDEX IF NOT EXISTS idx_nb_ind_expires ON northbound_individual(expires_at)`,

  // 两融标的
  `CREATE TABLE IF NOT EXISTS margin_target (
  trade_date TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  fin_balance REAL,
  fin_buy_amount REAL,
  fin_repay_amount REAL,
  loan_balance REAL,
  loan_sell_volume REAL,
  loan_repay_volume REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (trade_date, code)
)`,
  `CREATE INDEX IF NOT EXISTS idx_margin_target_expires ON margin_target(expires_at)`,

  // 大宗交易市场统计
  `CREATE TABLE IF NOT EXISTS block_trade_market (
  trade_date TEXT NOT NULL,
  sh_close   REAL,
  sh_change_pct REAL,
  total_amount REAL,
  premium_amount REAL,
  premium_ratio REAL,
  discount_amount REAL,
  discount_ratio REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (trade_date)
)`,

  // 大宗交易按股日统计
  `CREATE TABLE IF NOT EXISTS block_trade_daily (
  trade_date TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  change_pct REAL,
  close_price REAL,
  deal_count INTEGER,
  deal_total_amount REAL,
  deal_total_volume REAL,
  premium_amount REAL,
  discount_amount REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (trade_date, code)
)`,

  // 集合竞价快照
  `CREATE TABLE IF NOT EXISTS auction_snapshot (
  trade_date TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  auction_price REAL,
  auction_pct REAL,
  auction_volume REAL,
  auction_amount REAL,
  auction_unmatched REAL,
  auction_turnover_pct REAL,
  pre_close_price REAL,
  open_price REAL,
  last_price REAL,
  float_market_cap REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (trade_date, code)
)`,
  `CREATE INDEX IF NOT EXISTS idx_auction_expires ON auction_snapshot(expires_at)`,

  // 短线风向标
  `CREATE TABLE IF NOT EXISTS short_term_benchmark (
  trade_date TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  auction_pct REAL,
  tags       TEXT,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (trade_date, code)
)`,

  // 基金档案
  `CREATE TABLE IF NOT EXISTS fund_profile (
  symbol_key TEXT NOT NULL,
  ticker     TEXT NOT NULL,
  fund_name  TEXT,
  estab_date_ms INTEGER,
  mgmt_name  TEXT,
  manager_name TEXT,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (symbol_key)
)`,

  // 基金持仓
  `CREATE TABLE IF NOT EXISTS fund_holding (
  symbol_key TEXT NOT NULL,
  ticker     TEXT NOT NULL,
  stock_name TEXT NOT NULL,
  hold_ratio REAL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (symbol_key, ticker)
)`,

  // 基金净值
  `CREATE TABLE IF NOT EXISTS fund_nav (
  symbol_key TEXT NOT NULL,
  nav_date   TEXT NOT NULL,
  unit_nav   REAL,
  adj_nav    REAL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (symbol_key, nav_date)
)`,

  // 基金分红
  `CREATE TABLE IF NOT EXISTS fund_dividend (
  fund_code  TEXT NOT NULL,
  fund_name  TEXT NOT NULL,
  equity_record_date TEXT,
  ex_dividend_date TEXT,
  dividend_per_share REAL,
  pay_date   TEXT,
  dividend_type TEXT,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (fund_code, ex_dividend_date)
)`,

  // 基金同类排名走势
  `CREATE TABLE IF NOT EXISTS fund_rank_history (
  fund_code  TEXT NOT NULL,
  fund_name  TEXT,
  trade_date TEXT NOT NULL,
  rank_no    INTEGER,
  total      INTEGER,
  percentile REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (fund_code, trade_date)
)`,
  `CREATE INDEX IF NOT EXISTS idx_fund_rank_expires ON fund_rank_history(expires_at)`,

  // 筹码分布
  `CREATE TABLE IF NOT EXISTS chip_distribution (
  symbol_key TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  profit_ratio REAL,
  avg_cost   REAL,
  cost90_low REAL,
  cost90_high REAL,
  concentration90 REAL,
  cost70_low REAL,
  cost70_high REAL,
  concentration70 REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (symbol_key, trade_date)
)`,
  `CREATE INDEX IF NOT EXISTS idx_chip_expires ON chip_distribution(expires_at)`,

  // 期权 T 型报价腿
  `CREATE TABLE IF NOT EXISTS option_leg (
  quote_kind TEXT NOT NULL,  -- calls | puts
  product    TEXT NOT NULL,
  contract   TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  buy_volume REAL,
  buy_price  REAL,
  price      REAL,
  ask_price  REAL,
  ask_volume REAL,
  open_interest REAL,
  change_amt REAL,
  strike_price REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (quote_kind, product, contract, symbol)
)`,

  // 期权日 K
  `CREATE TABLE IF NOT EXISTS option_kline (
  kind       TEXT NOT NULL,  -- index | commodity | etf
  code       TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  open_price REAL,
  high_price REAL,
  low_price  REAL,
  close_price REAL,
  volume     REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (kind, code, trade_date)
)`,
  `CREATE INDEX IF NOT EXISTS idx_opt_kline_expires ON option_kline(expires_at)`,

  // 中金所期权行情
  `CREATE TABLE IF NOT EXISTS option_cffex (
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  price      REAL,
  change_amt REAL,
  change_pct REAL,
  volume     REAL,
  amount     REAL,
  open_interest REAL,
  strike_price REAL,
  remain_days INTEGER,
  prev_settle REAL,
  open_price REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (code)
)`,
  `CREATE INDEX IF NOT EXISTS idx_opt_cffex_expires ON option_cffex(expires_at)`,

  // 期权龙虎榜
  `CREATE TABLE IF NOT EXISTS option_lhb (
  trade_date TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  target_name TEXT NOT NULL,
  trade_type TEXT,
  rank_no    INTEGER,
  member_name TEXT,
  buy_volume REAL,
  sell_volume REAL,
  net_buy_volume REAL,
  buy_volume_ratio REAL,
  sell_volume_ratio REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (trade_date, symbol, member_name)
)`,

  // 期货 K 线
  `CREATE TABLE IF NOT EXISTS futures_kline (
  kind       TEXT NOT NULL,  -- domestic | global
  code       TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  name       TEXT,
  open_price REAL,
  high_price REAL,
  low_price  REAL,
  close_price REAL,
  volume     REAL,
  amount     REAL,
  change_pct REAL,
  change_amt REAL,
  open_interest REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (kind, code, trade_date)
)`,
  `CREATE INDEX IF NOT EXISTS idx_fut_kline_expires ON futures_kline(expires_at)`,

  // 全球期货行情
  `CREATE TABLE IF NOT EXISTS futures_spot (
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  price      REAL,
  change_amt REAL,
  change_pct REAL,
  open_price REAL,
  high_price REAL,
  low_price  REAL,
  prev_settle REAL,
  volume     REAL,
  open_interest REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (code)
)`,
  `CREATE INDEX IF NOT EXISTS idx_fut_spot_expires ON futures_spot(expires_at)`,

  // 期货库存
  `CREATE TABLE IF NOT EXISTS futures_inventory (
  kind       TEXT NOT NULL,  -- domestic | comex
  code       TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  name       TEXT,
  inventory  REAL,
  change_amt REAL,
  storage_ton REAL,
  storage_ounce REAL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (kind, code, trade_date)
)`,
  `CREATE INDEX IF NOT EXISTS idx_fut_inv_expires ON futures_inventory(expires_at)`,

  // 指数目录
  `CREATE TABLE IF NOT EXISTS index_catalog (
  tag        TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (tag, code)
)`,

  // 指数成分
  `CREATE TABLE IF NOT EXISTS index_constituent (
  index_code TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  snapshot_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (index_code, code)
)`,
  `CREATE INDEX IF NOT EXISTS idx_idx_const_expires ON index_constituent(expires_at)`,

  // 个股档案
  `CREATE TABLE IF NOT EXISTS stock_info (
  code       TEXT NOT NULL,
  name       TEXT,
  industry   TEXT,
  payload    TEXT,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (code)
)`,

  // 复权因子（getAdjustmentFactors 落盘；与 kline 表配套）
  `CREATE TABLE IF NOT EXISTS adjustment_factor (
  symbol_key TEXT NOT NULL,
  ticker     TEXT NOT NULL,
  ex_date_ms INTEGER NOT NULL,
  dividend_per_share REAL,
  per_share_bonus REAL,
  allotment_ratio REAL,
  allotment_price REAL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (symbol_key, ex_date_ms)
)`,

  // 透传结果兜底（仅结构极不稳定、暂不值得建列的响应）
  `CREATE TABLE IF NOT EXISTS method_cache (
  cache_key  TEXT NOT NULL,
  method     TEXT NOT NULL,
  args_hash  TEXT NOT NULL,
  payload    TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (cache_key)
)`,
  `CREATE INDEX IF NOT EXISTS idx_method_cache_expires ON method_cache(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_method_cache_method ON method_cache(method)`,

  // 最新交易信号（每标的一条，INSERT OR REPLACE）
  `CREATE TABLE IF NOT EXISTS trade_signal (
  symbol_key TEXT NOT NULL,
  code       TEXT NOT NULL,
  exchange   TEXT NOT NULL,
  side       TEXT NOT NULL,
  strength   REAL NOT NULL,
  reasons    TEXT NOT NULL,
  details    TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  PRIMARY KEY (symbol_key)
)`,
  `CREATE INDEX IF NOT EXISTS idx_trade_signal_ts ON trade_signal(ts DESC)`,

  // 策略档案（用户可编辑配置单元）
  `CREATE TABLE IF NOT EXISTS strategy_profile (
  id          TEXT NOT NULL,
  template_id TEXT NOT NULL,
  name        TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  enabled     INTEGER NOT NULL DEFAULT 1,
  auto_trade  INTEGER NOT NULL DEFAULT 0,
  params      TEXT NOT NULL DEFAULT '{}',
  selection   TEXT NOT NULL DEFAULT '{}',
  exit_rules  TEXT NOT NULL DEFAULT '{}',
  trade_rules TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (id)
)`,

  // 模拟账户（每 profileId 一行；profile_id 为空串 = 默认全局账户）
  `CREATE TABLE IF NOT EXISTS sim_account (
  profile_id TEXT NOT NULL,
  init_cash  REAL NOT NULL,
  cash       REAL NOT NULL,
  frozen     REAL NOT NULL DEFAULT 0,
  initialized INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id)
)`,

  `CREATE TABLE IF NOT EXISTS sim_position (
  profile_id  TEXT NOT NULL,
  symbol_key  TEXT NOT NULL,
  code        TEXT NOT NULL,
  exchange    TEXT NOT NULL,
  shares      REAL NOT NULL,
  available   REAL NOT NULL,
  cost_price  REAL NOT NULL,
  today_buy   REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, symbol_key)
)`,

  `CREATE TABLE IF NOT EXISTS sim_order (
  profile_id TEXT NOT NULL,
  id         TEXT NOT NULL,
  symbol_key TEXT NOT NULL,
  code       TEXT NOT NULL,
  exchange   TEXT NOT NULL,
  side       TEXT NOT NULL,
  type       TEXT NOT NULL,
  price      REAL NOT NULL,
  quantity   REAL NOT NULL,
  filled_qty REAL NOT NULL DEFAULT 0,
  status     TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_sim_order_created ON sim_order(profile_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS sim_trade (
  profile_id TEXT NOT NULL,
  id         TEXT NOT NULL,
  order_id   TEXT NOT NULL,
  symbol_key TEXT NOT NULL,
  code       TEXT NOT NULL,
  exchange   TEXT NOT NULL,
  side       TEXT NOT NULL,
  price      REAL NOT NULL,
  quantity   REAL NOT NULL,
  amount     REAL NOT NULL,
  fee        REAL NOT NULL,
  cash_delta REAL NOT NULL,
  ts         INTEGER NOT NULL,
  PRIMARY KEY (profile_id, id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_sim_trade_ts ON sim_trade(profile_id, ts DESC)`,

  // 已跟单信号去重（symbol_key + side）
  `CREATE TABLE IF NOT EXISTS followed_signal (
  dedupe_key  TEXT NOT NULL,
  symbol_key  TEXT NOT NULL,
  side        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (dedupe_key)
)`,

  // 扫描快照：每次全市场扫描落一条头部 + N 条命中明细
  `CREATE TABLE IF NOT EXISTS scan_snapshot (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  criteria    TEXT NOT NULL,
  total       INTEGER NOT NULL,
  hit_count   INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_scan_snapshot_created ON scan_snapshot(created_at DESC)`,

  // 扫描命中明细（候选池）
  `CREATE TABLE IF NOT EXISTS scan_hit (
  snapshot_id INTEGER NOT NULL,
  code        TEXT NOT NULL,
  exchange    TEXT NOT NULL,
  name        TEXT NOT NULL,
  reasons     TEXT NOT NULL,
  last_close  REAL NOT NULL,
  change_pct  REAL,
  metrics     TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, code, exchange)
)`,
];

/**
 * 幂等建库建表。无历史库、无版本迁移：每次启动执行 CREATE TABLE IF NOT EXISTS。
 *
 * 额外做「缺列修复」：旧版本建过同名表但列不全时，CREATE IF NOT EXISTS 不会补列，
 * 后续 INSERT/SELECT name 等列会报 no such column。这里用 PRAGMA table_info 检查，
 * 缺列则 ALTER TABLE ADD COLUMN（开发期语义：保数据、补结构）。
 */
const COLUMN_REPAIRS: Array<{ table: string; columns: Array<{ name: string; ddl: string }> }> = [
  {
    table: 'tickers',
    columns: [
      { name: 'name', ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: 'assetType', ddl: "TEXT NOT NULL DEFAULT ''" },
    ],
  },
  {
    table: 'watchlist',
    columns: [{ name: 'name', ddl: "TEXT NOT NULL DEFAULT ''" }],
  },
  {
    table: 'watchlist_group',
    columns: [
      { name: 'kind', ddl: "TEXT NOT NULL DEFAULT 'static'" },
      { name: 'rule', ddl: 'TEXT' },
    ],
  },
  {
    table: 'watchlist_group_item',
    columns: [{ name: 'name', ddl: "TEXT NOT NULL DEFAULT ''" }],
  },
  {
    table: 'holding',
    columns: [
      { name: 'name', ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: 'shares', ddl: 'REAL NOT NULL DEFAULT 0' },
      { name: 'cost_price', ddl: 'REAL NOT NULL DEFAULT 0' },
    ],
  },
  {
    table: 'scan_hit',
    columns: [{ name: 'name', ddl: "TEXT NOT NULL DEFAULT ''" }],
  },
  {
    table: 'stock_info',
    columns: [
      { name: 'name', ddl: 'TEXT' },
      { name: 'industry', ddl: 'TEXT' },
    ],
  },
  {
    table: 'index_catalog',
    columns: [{ name: 'name', ddl: "TEXT NOT NULL DEFAULT ''" }],
  },
  {
    table: 'index_constituent',
    columns: [{ name: 'name', ddl: "TEXT NOT NULL DEFAULT ''" }],
  },
];

async function repairMissingColumns(db: DB): Promise<void> {
  for (const { table, columns } of COLUMN_REPAIRS) {
    let info;
    try {
      info = await db.execute(`PRAGMA table_info(${table})`);
    } catch {
      continue; // 表不存在等异常跳过，由后续查询自然暴露
    }
    const have = new Set(
      ((info.rows ?? []) as Array<Record<string, unknown>>).map((r) => String(r.name ?? '')),
    );
    if (have.size === 0) continue; // 表不存在
    for (const col of columns) {
      if (have.has(col.name)) continue;
      try {
        await db.execute(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.ddl}`);
      } catch {
        // 并发/只读失败不阻断启动
      }
    }
  }
}

export async function applySchema(db: DB): Promise<void> {
  await db.transaction(async (tx) => {
    for (const ddl of DDL_STATEMENTS) {
      await tx.execute(ddl);
    }
  });
  await repairMissingColumns(db);
}
