/**
 * 回测引擎（M5 核心，纯函数）。
 * 输入策略 + 历史 K 线 + 初始资金，逐根 bar 回放信号并成交，
 * 产出交易序列、权益曲线与绩效指标（收益率/年化/最大回撤/夏普/胜率/盈亏比）。
 * 与 UI / 存储解耦，便于单测。
 *
 * 成本模型（A 股默认，可配）：
 *  - 佣金：双边 commissionRate（默认万 2.5），最低 minCommission（默认 5 元）
 *  - 印花税：卖出 stampTaxRate（默认 0.05%）
 *  - 过户费：双边 transferFeeRate（默认 0.001%）
 *  - 滑点：slippageBp（基点，默认 0），买加卖减
 *
 * 复权/公司行为：
 *  - 前复权连续序列：直接回放，无需 corporateActions；
 *  - 不复权序列：传入 corporateActions，除权日自动加现金/加股并下调成本。
 */
import type { Candle, Quote } from '@/data/api';
import type { PartialSignal, SignalSide } from '@/domain';
import type { ProfileEvaluator } from './profile';
import { checkExitRules, checkTrailingStop, type ExitRules } from './profile';
import type { AdjustmentFactorInput } from './adjustment';
import {
  DEFAULT_BARS_PER_YEAR,
  annualizedReturnPct,
  annualizedVolatilityPct,
  calmarRatio,
  maxDrawdownDetail,
  sharpeRatio,
  sortinoRatio,
} from './metrics';

export interface BacktestTrade {
  index: number;
  time: number;
  side: Exclude<SignalSide, 'hold'>;
  price: number;
  shares: number;
  fee: number;
  cashAfter: number;
  /**
   * 平仓时该笔往返的盈亏（仅 sell 有值）。
   * 口径：`卖出净回款 − 该持仓净投入`，净投入已扣除持有期间的分红、
   * 加上配股缴款，因此除权场景下不失真（早期版本用「买价 vs 卖价」配对，
   * 遇到送转会算出假亏损）。
   */
  pnl?: number;
  /** 该笔往返盈亏率（%，相对净投入） */
  pnlPct?: number;
  /** 持有 bar 数（仅 sell 有值） */
  holdingBars?: number;
}

/** 除权除息事件应用记录 */
export interface CorpEventLog {
  index: number;
  time: number;
  /** 现金变动（分红为正） */
  cashDelta: number;
  /** 股数变动（送转为正） */
  sharesDelta: number;
  note: string;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  /** 每日权益（现金 + 持仓市值），与 K 线等长 */
  equity: number[];
  initCash: number;
  finalEquity: number;
  /** 绩效 */
  totalReturnPct: number;
  /** 年化收益率（%），按 `barsPerYear` 折算（日 K 默认 252） */
  annualizedReturnPct: number;
  maxDrawdownPct: number;
  /** 最长回撤持续 bar 数 */
  longestDrawdownBars: number;
  /** 期末距最近一次新高的 bar 数（0 = 正在创新高） */
  trailingDrawdownBars: number;
  sharpe: number;
  /** 索提诺比率（只惩罚下行波动） */
  sortino: number;
  /** 卡玛比率（年化 / 最大回撤） */
  calmar: number;
  /** 年化波动率（%） */
  volatilityPct: number;
  winRate: number;
  /** 盈亏比（平均盈利 / 平均亏损），无亏损交易时为 Infinity */
  profitFactor: number;
  /** 持仓占比（有仓位的 bar / 总 bar，%） */
  exposurePct: number;
  /** 平均持有 bar 数（按已平仓往返计） */
  avgHoldingBars: number;
  /** 最佳单笔往返盈亏率（%） */
  bestTradePct: number;
  /** 最差单笔往返盈亏率（%） */
  worstTradePct: number;
  /** 总交易成本 */
  totalFees: number;
  /** 公司行为事件（仅传入 corporateActions 且有持仓触发时） */
  corpEvents: CorpEventLog[];
}

/** A 股默认成本参数 */
export interface CostModel {
  /** 佣金费率（单边），默认 0.00025（万 2.5） */
  commissionRate: number;
  /** 最低佣金（元/笔），默认 5 */
  minCommission: number;
  /** 印花税（卖出），默认 0.0005（0.05%） */
  stampTaxRate: number;
  /** 过户费（双边），默认 0.00001（0.001%） */
  transferFeeRate: number;
  /** 滑点（基点），买加卖减，默认 0 */
  slippageBp: number;
}

export const DEFAULT_COST: CostModel = {
  commissionRate: 0.00025,
  minCommission: 5,
  stampTaxRate: 0.0005,
  transferFeeRate: 0.00001,
  slippageBp: 0,
};

export interface BacktestOptions {
  initCash?: number;
  /** 单笔仓位比例（占总现金），默认 1（全仓）；自动夹到 [0,1] */
  positionRatio?: number;
  /** 整手基数，默认 100 */
  lotSize?: number;
  strategyId?: string;
  /** 止盈止损/移动止损（可选，0 关闭；以收盘价近似触发） */
  exit?: ExitRules;
  /** 成本模型，部分覆盖 DEFAULT_COST */
  cost?: Partial<CostModel>;
  /**
   * 年化折算用的「每年 bar 数」，默认 252（日 K）。
   * 非日 K **必须**传入（可用 `barsPerYearOfPeriod` 换算），
   * 否则分钟/周月 K 的年化收益与夏普会被严重放大或缩小。
   */
  barsPerYear?: number;
  /** 无风险年利率（%），用于夏普/索提诺的超额收益，默认 0 */
  riskFreeAnnualPct?: number;
  /**
   * 公司行为（分红/送转/配股）。用于**不复权** K 线回放：
   * 持仓跨过除权日时自动调整现金与股数。前复权序列不要传。
   */
  corporateActions?: AdjustmentFactorInput[];
  /**
   * 成交时机：
   * - close（默认）：信号当根收盘成交（偏乐观，兼容旧行为）
   * - nextOpen：信号次日开盘成交（更贴近实盘，降低前视乐观）
   */
  execution?: 'close' | 'nextOpen';
}

/** 计算单笔交易总费用（佣金 + 印花税 + 过户费），佣金取 max(最低, 比例) */
function calcFee(amount: number, side: 'buy' | 'sell', cost: CostModel): number {
  const commission = Math.max(amount * cost.commissionRate, cost.minCommission);
  const stamp = side === 'sell' ? amount * cost.stampTaxRate : 0;
  const transfer = amount * cost.transferFeeRate;
  return commission + stamp + transfer;
}

/* ------------------------------------------------------------------ *
 * 以下为「回测内部构件」，对外暴露是因为买入持有基准（buyHold）必须
 * 复用同一套费用/手数/除权逻辑，否则两条曲线的对照不成立。
 * ------------------------------------------------------------------ */

export interface BuyPlan {
  shares: number;
  amount: number;
  fee: number;
}

/** 单笔买入整手规划（预算 + 整手 + 费用三重约束） */
export function planBuy(
  cash: number,
  price: number,
  positionRatio: number,
  lotSize: number,
  cost: CostModel,
): BuyPlan | null {
  if (!(cash > 0) || !(price > 0) || !(lotSize > 0)) return null;
  const budget = Math.min(cash, cash * positionRatio);
  if (!(budget > 0)) return null;
  const maxLots = Math.floor(budget / price / lotSize);
  if (maxLots < 1) return null;
  const steps = Math.min(maxLots, 64);
  for (let k = 0; k < steps; k++) {
    const lots = maxLots - k;
    const shares = lots * lotSize;
    const amount = shares * price;
    const fee = calcFee(amount, 'buy', cost);
    if (amount + fee <= budget) return { shares, amount, fee };
  }
  return null;
}

export function timeOf(c: Candle): number {
  return new Date(c.datetime).getTime();
}

export interface PosState {
  cash: number;
  shares: number;
  avgCost: number;
  peak: number;
}

/**
 * 应用「窗口内新到达」的除权事件。
 * - 仅处理 firstBarTime < exDateMs <= barTime 的事件（窗口前事件已体现在价格里）
 * - 现金分红：cash += shares * D；avgCost -= D；peak -= D
 * - 送股比例 B：shares *= (1+B)；avgCost /= (1+B)；peak /= (1+B)
 * - 配股：按比例认购（现金不足则部分认购，简化）
 * 未持仓时事件仍被标记已处理（分红只归持股人）。
 */
export function applyCorpActionsAtBar(
  bar: Candle,
  firstBarTime: number,
  actions: AdjustmentFactorInput[],
  applied: Set<number>,
  pos: PosState,
  logs: CorpEventLog[],
): void {
  const barTime = timeOf(bar);
  for (let e = 0; e < actions.length; e++) {
    if (applied.has(e)) continue;
    const ev = actions[e];
    const t = Math.round(ev.exDateMs);
    if (!Number.isFinite(t)) {
      applied.add(e);
      continue;
    }
    if (t <= firstBarTime) {
      applied.add(e); // 窗口前，价格已反映，不追溯
      continue;
    }
    if (t > barTime) continue; // 尚未到达
    applied.add(e);

    if (pos.shares <= 0) continue;

    let cashDelta = 0;
    let sharesDelta = 0;
    const notes: string[] = [];

    const div = ev.dividendPerShare ?? 0;
    if (div > 0) {
      cashDelta += pos.shares * div;
      pos.cash += pos.shares * div;
      pos.avgCost = Math.max(0, pos.avgCost - div);
      pos.peak = Math.max(0, pos.peak - div);
      notes.push(`分红 ${div}/股`);
    }

    const bonus = ev.perShareBonus ?? 0;
    if (bonus > 0) {
      const add = pos.shares * bonus;
      pos.shares += add;
      sharesDelta += add;
      if (pos.shares > 0) {
        pos.avgCost = pos.avgCost / (1 + bonus);
        pos.peak = pos.peak / (1 + bonus);
      }
      notes.push(`送股 ${bonus}`);
    }

    const allotRatio = ev.allotmentRatio ?? 0;
    if (allotRatio > 0 && (ev.allotmentPrice ?? 0) > 0) {
      const price = ev.allotmentPrice!;
      const want = pos.shares * allotRatio;
      // 用当前现金尽可能认购（回测引擎简化：允许非整手配股）
      const afford = Math.max(0, Math.floor(pos.cash / price));
      const take = Math.min(want, afford);
      if (take > 0) {
        const pay = take * price;
        pos.cash -= pay;
        cashDelta -= pay;
        const newShares = pos.shares + take;
        pos.avgCost = (pos.avgCost * pos.shares + pay) / newShares;
        pos.shares = newShares;
        sharesDelta += take;
        notes.push(`配股 ${allotRatio}@${price}`);
      }
    }

    if (notes.length > 0) {
      logs.push({
        index: 0, // 由调用方补 index
        time: barTime,
        cashDelta,
        sharesDelta,
        note: notes.join(' · '),
      });
    }
  }
}

/**
 * 运行回测。逐根 bar 调用 evaluate(candles[0..i])：
 * - buy 且无持仓：以当根 close + 滑点 买入（positionRatio 现金，整手）
 * - sell 且有持仓：以当根 close - 滑点 全平
 * 未持仓时权益 = 现金；持仓时权益 = 现金 + 持仓市值。
 * 传入 corporateActions 时，在除权日调整现金/股数（不复权序列）。
 */
export function runBacktest(
  evaluate: ProfileEvaluator,
  candles: Candle[],
  opts: BacktestOptions = {},
): BacktestResult {
  const initCash = opts.initCash ?? 100_000;
  const positionRatio = Math.min(1, Math.max(0, opts.positionRatio ?? 1));
  const lotSize = opts.lotSize ?? 100;
  const barsPerYear =
    opts.barsPerYear != null && opts.barsPerYear > 0 ? opts.barsPerYear : DEFAULT_BARS_PER_YEAR;
  const riskFreeAnnualPct = opts.riskFreeAnnualPct ?? 0;
  const cost: CostModel = { ...DEFAULT_COST, ...opts.cost };
  const slip = cost.slippageBp / 10_000;
  const corpActions = (opts.corporateActions ?? []).filter((a) => Number.isFinite(a.exDateMs));

  let cash = initCash;
  let shares = 0;
  let avgCost = 0;
  let peak = 0; // 开仓后最高价（移动止损用）
  /**
   * 当前持仓的**净投入**：买入金额 + 买入费用，减去持有期现金分红，加上配股缴款。
   * 用它结清盈亏，才能在送转/分红场景下算对——早期用「买价 vs 卖价」配对，
   * 10 送 10 后卖价腰斩会被判成巨亏。
   */
  let basis = 0;
  /** 建仓 bar 下标（-1 = 空仓） */
  let entryIndex = -1;
  const trades: BacktestTrade[] = [];
  const equity: number[] = [];
  const corpEvents: CorpEventLog[] = [];
  let totalFees = 0;
  let heldBars = 0;
  let wins = 0;
  let totalWin = 0;
  let totalLoss = 0;
  let roundTrips = 0;
  let holdingBarsSum = 0;
  let bestSeen = -Infinity;
  let worstSeen = Infinity;
  const appliedCorp = new Set<number>();
  const firstBarTime = candles.length > 0 ? timeOf(candles[0]) : 0;
  const execution = opts.execution ?? 'close';
  /** nextOpen 模式：上一 bar 信号留到本 bar 开盘执行 */
  let pendingSide: Exclude<SignalSide, 'hold'> | null = null;

  /** 开仓：按仓位比例买「装得下的最大整手」 */
  const openPosition = (price: number, i: number): void => {
    if (shares > 0 || cash <= 0) return;
    const plan = planBuy(cash, price, positionRatio, lotSize, cost);
    if (!plan) return;
    cash -= plan.amount + plan.fee;
    shares = plan.shares;
    avgCost = price;
    peak = price;
    basis = plan.amount + plan.fee;
    entryIndex = i;
    totalFees += plan.fee;
    trades.push({
      index: i,
      time: timeOf(candles[i]),
      side: 'buy',
      price,
      shares: plan.shares,
      fee: plan.fee,
      cashAfter: cash,
    });
  };

  /** 平仓：全平并按净投入结清该笔往返盈亏 */
  const closePosition = (price: number, i: number): void => {
    if (shares <= 0) return;
    const amount = shares * price;
    const fee = calcFee(amount, 'sell', cost);
    cash += amount - fee;
    totalFees += fee;
    const pnl = amount - fee - basis;
    const pnlPct = basis > 0 ? (pnl / basis) * 100 : 0;
    const held = entryIndex >= 0 ? i - entryIndex : 0;
    roundTrips += 1;
    holdingBarsSum += held;
    if (pnl > 0) {
      wins += 1;
      totalWin += pnl;
    } else {
      totalLoss += Math.abs(pnl);
    }
    if (pnlPct > bestSeen) bestSeen = pnlPct;
    if (pnlPct < worstSeen) worstSeen = pnlPct;
    trades.push({
      index: i,
      time: timeOf(candles[i]),
      side: 'sell',
      price,
      shares,
      fee,
      cashAfter: cash,
      pnl,
      pnlPct,
      holdingBars: held,
    });
    shares = 0;
    avgCost = 0;
    peak = 0;
    basis = 0;
    entryIndex = -1;
  };

  for (let i = 0; i < candles.length; i++) {
    // 除权事件先于当日信号/撮合：开盘前已调整持仓
    if (corpActions.length > 0) {
      const cashBeforeCorp = cash;
      if (shares > 0) {
        const before: PosState = { cash, shares, avgCost, peak };
        applyCorpActionsAtBar(candles[i], firstBarTime, corpActions, appliedCorp, before, corpEvents);
        cash = before.cash;
        shares = before.shares;
        avgCost = before.avgCost;
        peak = before.peak;
        // 补 index
        for (const log of corpEvents) {
          if (log.index === 0 && log.time === timeOf(candles[i])) log.index = i;
        }
      } else {
        // 未持仓也推进事件游标，避免日后开仓追溯
        const dummy: PosState = { cash, shares: 0, avgCost, peak };
        applyCorpActionsAtBar(candles[i], firstBarTime, corpActions, appliedCorp, dummy, []);
      }
      // 分红进现金 → 净投入下调；配股缴款出现金 → 净投入上调
      basis -= cash - cashBeforeCorp;
    }

    // --- nextOpen：先用昨日信号在本 bar 开盘撮合 ---
    if (execution === 'nextOpen' && pendingSide && i > 0) {
      const openPx = candles[i].open > 0 ? candles[i].open : candles[i].close;
      if (pendingSide === 'buy') openPosition(openPx * (1 + slip), i);
      else if (pendingSide === 'sell') closePosition(openPx * (1 - slip), i);
      pendingSide = null;
    }

    const signal = evaluate(candles.slice(0, i + 1));
    const rawPrice = candles[i].close;
    let side = signal?.side ?? 'hold';

    // 持仓风控：先看固定止盈/止损，再看移动止损（都不命中才轮到信号离场）
    if (shares > 0 && opts.exit) {
      const hit = checkExitRules(avgCost, rawPrice, opts.exit);
      if (hit) {
        side = 'sell';
      } else if (opts.exit.trailingPct > 0 && peak > 0 && checkTrailingStop(peak, rawPrice, opts.exit.trailingPct)) {
        side = 'sell';
      }
    }

    if (execution === 'nextOpen') {
      if (side === 'buy' || side === 'sell') pendingSide = side;
    } else if (side === 'buy') {
      openPosition(rawPrice * (1 + slip), i);
    } else if (side === 'sell') {
      closePosition(rawPrice * (1 - slip), i);
    } else if (shares > 0 && rawPrice > peak) {
      peak = rawPrice; // 持仓浮盈刷新移动止损基准
    }

    if (shares > 0) heldBars += 1;
    equity.push(cash + shares * rawPrice);
  }

  const finalEquity = equity.length ? equity[equity.length - 1] : initCash;
  const totalReturn = initCash > 0 ? ((finalEquity - initCash) / initCash) * 100 : 0;
  const bars = candles.length;

  // 年化 / 风险指标：统一走 metrics，年化因子由 barsPerYear 决定（周期感知）
  const annPct = annualizedReturnPct(equity, barsPerYear);
  const dd = maxDrawdownDetail(equity);
  const winRate = roundTrips > 0 ? (wins / roundTrips) * 100 : 0;
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0;

  return {
    trades,
    equity,
    initCash,
    finalEquity,
    totalReturnPct: totalReturn,
    annualizedReturnPct: annPct,
    maxDrawdownPct: dd.maxDdPct,
    longestDrawdownBars: dd.longestDdBars,
    trailingDrawdownBars: dd.trailingDdBars,
    sharpe: sharpeRatio(equity, barsPerYear, riskFreeAnnualPct),
    sortino: sortinoRatio(equity, barsPerYear, riskFreeAnnualPct),
    calmar: calmarRatio(annPct, dd.maxDdPct),
    volatilityPct: annualizedVolatilityPct(equity, barsPerYear),
    winRate,
    profitFactor,
    exposurePct: bars > 0 ? (heldBars / bars) * 100 : 0,
    avgHoldingBars: roundTrips > 0 ? holdingBarsSum / roundTrips : 0,
    bestTradePct: roundTrips > 0 && Number.isFinite(bestSeen) ? bestSeen : 0,
    worstTradePct: roundTrips > 0 && Number.isFinite(worstSeen) ? worstSeen : 0,
    totalFees,
    corpEvents,
  };
}
