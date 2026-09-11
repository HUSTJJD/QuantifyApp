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
import type { Candle } from '@/data/api';
import type { Strategy, StrategyContext, SignalSide } from './strategies';
import { checkExitRules, checkTrailingStop, type ExitRules } from './profile';
import type { AdjustmentFactorInput } from './adjustment';

export interface BacktestTrade {
  index: number;
  time: number;
  side: Exclude<SignalSide, 'hold'>;
  price: number;
  shares: number;
  fee: number;
  cashAfter: number;
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
  /** 年化收益率（%），按 252 交易日 */
  annualizedReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  winRate: number;
  /** 盈亏比（平均盈利 / 平均亏损），无亏损交易时为 Infinity */
  profitFactor: number;
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
  /** 单笔仓位比例（占总现金），默认 1（全仓） */
  positionRatio?: number;
  /** 整手基数，默认 100 */
  lotSize?: number;
  strategyId?: string;
  /** 止盈止损/移动止损（可选，0 关闭；以收盘价近似触发） */
  exit?: ExitRules;
  /** 成本模型，部分覆盖 DEFAULT_COST */
  cost?: Partial<CostModel>;
  /**
   * 公司行为（分红/送转/配股）。用于**不复权** K 线回放：
   * 持仓跨过除权日时自动调整现金与股数。前复权序列不要传。
   */
  corporateActions?: AdjustmentFactorInput[];
}

/** 计算单笔交易总费用（佣金 + 印花税 + 过户费），佣金取 max(最低, 比例) */
function calcFee(amount: number, side: 'buy' | 'sell', cost: CostModel): number {
  const commission = Math.max(amount * cost.commissionRate, cost.minCommission);
  const stamp = side === 'sell' ? amount * cost.stampTaxRate : 0;
  const transfer = amount * cost.transferFeeRate;
  return commission + stamp + transfer;
}

/** 计算最大回撤（百分比，正值）。 */
function maxDrawdown(equity: number[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd * 100;
}

/** 简易夏普：日收益均值 / 日收益标准差（年化因子按 252）。 */
function sharpe(equity: number[]): number {
  if (equity.length < 3) return 0;
  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    if (equity[i - 1] > 0) rets.push((equity[i] - equity[i - 1]) / equity[i - 1]);
  }
  if (rets.length === 0) return 0;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(252);
}

function timeOf(c: Candle): number {
  return new Date(c.datetime).getTime();
}

interface PosState {
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
function applyCorpActionsAtBar(
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
 * 运行回测。逐根 bar 调用 strategy.evaluate(candles[0..i])：
 * - buy 且无持仓：以当根 close + 滑点 买入（positionRatio 现金，整手）
 * - sell 且有持仓：以当根 close - 滑点 全平
 * 未持仓时权益 = 现金；持仓时权益 = 现金 + 持仓市值。
 * 传入 corporateActions 时，在除权日调整现金/股数（不复权序列）。
 */
export function runBacktest(
  strategy: Strategy,
  candles: Candle[],
  opts: BacktestOptions = {},
): BacktestResult {
  const initCash = opts.initCash ?? 100_000;
  const positionRatio = opts.positionRatio ?? 1;
  const lotSize = opts.lotSize ?? 100;
  const cost: CostModel = { ...DEFAULT_COST, ...opts.cost };
  const slip = cost.slippageBp / 10_000;
  const corpActions = (opts.corporateActions ?? []).filter((a) => Number.isFinite(a.exDateMs));

  let cash = initCash;
  let shares = 0;
  let avgCost = 0;
  let peak = 0; // 开仓后最高价（移动止损用）
  const trades: BacktestTrade[] = [];
  const equity: number[] = [];
  const corpEvents: CorpEventLog[] = [];
  let totalFees = 0;
  const appliedCorp = new Set<number>();
  const firstBarTime = candles.length > 0 ? timeOf(candles[0]) : 0;

  for (let i = 0; i < candles.length; i++) {
    // 除权事件先于当日信号/撮合：开盘前已调整持仓
    if (corpActions.length > 0 && shares > 0) {
      const before = { cash, shares, avgCost, peak };
      applyCorpActionsAtBar(candles[i], firstBarTime, corpActions, appliedCorp, before, corpEvents);
      cash = before.cash;
      shares = before.shares;
      avgCost = before.avgCost;
      peak = before.peak;
      // 补 index
      for (const log of corpEvents) {
        if (log.index === 0 && log.time === timeOf(candles[i])) log.index = i;
      }
    } else if (corpActions.length > 0) {
      // 未持仓也推进事件游标，避免日后开仓追溯
      const dummy: PosState = { cash, shares: 0, avgCost, peak };
      applyCorpActionsAtBar(candles[i], firstBarTime, corpActions, appliedCorp, dummy, []);
    }

    const ctx: StrategyContext = {};
    const signal = strategy.evaluate(candles.slice(0, i + 1), ctx);
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

    if (side === 'buy' && shares === 0 && cash > 0) {
      const price = rawPrice * (1 + slip);
      const budget = cash * positionRatio;
      // 估算费用后可买股数：budget / (price + 单股费用)
      const estFeePerShare = calcFee(price, 'buy', cost) / Math.max(1, Math.floor(budget / price / lotSize) * lotSize || 1);
      const raw = Math.floor(budget / (price + estFeePerShare) / lotSize) * lotSize;
      if (raw > 0) {
        const amount = raw * price;
        const fee = calcFee(amount, 'buy', cost);
        if (amount + fee <= cash) {
          cash -= amount + fee;
          shares = raw;
          avgCost = price;
          peak = price;
          totalFees += fee;
          trades.push({ index: i, time: timeOf(candles[i]), side: 'buy', price, shares: raw, fee, cashAfter: cash });
        }
      }
    } else if (side === 'sell' && shares > 0) {
      const price = rawPrice * (1 - slip);
      const amount = shares * price;
      const fee = calcFee(amount, 'sell', cost);
      cash += amount - fee;
      totalFees += fee;
      trades.push({ index: i, time: timeOf(candles[i]), side: 'sell', price, shares, fee, cashAfter: cash });
      shares = 0;
      avgCost = 0;
      peak = 0;
    } else if (shares > 0 && rawPrice > peak) {
      peak = rawPrice; // 持仓浮盈刷新移动止损基准
    }

    const eq = cash + shares * rawPrice;
    equity.push(eq);
  }

  const finalEquity = equity.length ? equity[equity.length - 1] : initCash;
  const totalReturnPct = initCash > 0 ? ((finalEquity - initCash) / initCash) * 100 : 0;

  // 年化：按 bar 数近似交易日（日 K 一根=一日；分钟 K 需外部换算，这里按 252 日近似）
  const bars = candles.length;
  const annualizedReturnPct =
    bars > 0 && initCash > 0 && finalEquity > 0
      ? (Math.pow(finalEquity / initCash, 252 / bars) - 1) * 100
      : 0;

  // 胜率 + 盈亏比：按平仓配对
  const sells = trades.filter((t) => t.side === 'sell');
  let wins = 0;
  let totalWin = 0;
  let totalLoss = 0;
  for (const s of sells) {
    const prevBuy = [...trades].reverse().find((t) => t.side === 'buy' && t.index < s.index);
    if (prevBuy) {
      const pnl = (s.price - prevBuy.price) * s.shares - s.fee - prevBuy.fee;
      if (pnl > 0) {
        wins++;
        totalWin += pnl;
      } else {
        totalLoss += Math.abs(pnl);
      }
    }
  }
  const winRate = sells.length ? (wins / sells.length) * 100 : 0;
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0;

  return {
    trades,
    equity,
    initCash,
    finalEquity,
    totalReturnPct,
    annualizedReturnPct,
    maxDrawdownPct: maxDrawdown(equity),
    sharpe: sharpe(equity),
    winRate,
    profitFactor,
    totalFees,
    corpEvents,
  };
}
