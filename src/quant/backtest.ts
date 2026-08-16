/**
 * 回测引擎（M5 核心，纯函数）。
 * 输入策略 + 历史 K 线 + 初始资金，逐根 bar 回放信号并成交，
 * 产出交易序列、权益曲线与绩效指标（收益率/最大回撤/夏普）。
 * 与 UI / 存储解耦，便于单测。
 */
import type { Candle } from '@/api';
import type { Strategy, StrategyContext, SignalSide } from './strategies';
import { checkExitRules, checkTrailingStop, type ExitRules } from './profile';

export interface BacktestTrade {
  index: number;
  time: number;
  side: Exclude<SignalSide, 'hold'>;
  price: number;
  shares: number;
  fee: number;
  cashAfter: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  /** 每日权益（现金 + 持仓市值），与 K 线等长 */
  equity: number[];
  initCash: number;
  finalEquity: number;
  /** 绩效 */
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  winRate: number;
}

export interface BacktestOptions {
  initCash?: number;
  /** 单笔仓位比例（占总现金），默认 1（全仓） */
  positionRatio?: number;
  /** 手续费率（单边），默认 0.0005（万5） */
  feeRate?: number;
  /** 整手基数，默认 100 */
  lotSize?: number;
  strategyId?: string;
  /** 止盈止损/移动止损（可选，0 关闭；以收盘价近似触发） */
  exit?: ExitRules;
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

/**
 * 运行回测。逐根 bar 调用 strategy.evaluate(candles[0..i])：
 * - buy 且无持仓：以当根 close 买入（positionRatio 现金，整手）
 * - sell 且有持仓：以当根 close 全平
 * 未持仓时权益 = 现金；持仓时权益 = 现金 + 持仓市值。
 */
export function runBacktest(
  strategy: Strategy,
  candles: Candle[],
  opts: BacktestOptions = {},
): BacktestResult {
  const initCash = opts.initCash ?? 100_000;
  const positionRatio = opts.positionRatio ?? 1;
  const feeRate = opts.feeRate ?? 0.0005;
  const lotSize = opts.lotSize ?? 100;

  let cash = initCash;
  let shares = 0;
  let avgCost = 0;
  let peak = 0; // 开仓后最高价（移动止损用）
  const trades: BacktestTrade[] = [];
  const equity: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    const ctx: StrategyContext = {};
    const signal = strategy.evaluate(candles.slice(0, i + 1), ctx);
    const price = candles[i].close;
    let side = signal?.side ?? 'hold';

    // 持仓风控：先看固定止盈/止损，再看移动止损（都不命中才轮到信号离场）
    if (shares > 0 && opts.exit) {
      const hit = checkExitRules(avgCost, price, opts.exit);
      if (hit) {
        side = 'sell';
      } else if (opts.exit.trailingPct > 0 && peak > 0 && checkTrailingStop(peak, price, opts.exit.trailingPct)) {
        side = 'sell';
      }
    }

    if (side === 'buy' && shares === 0 && cash > 0) {
      const budget = cash * positionRatio;
      const raw = Math.floor(budget / (price * (1 + feeRate)) / lotSize) * lotSize;
      if (raw > 0) {
        const cost = raw * price;
        const fee = cost * feeRate;
        cash -= cost + fee;
        shares = raw;
        avgCost = price;
        peak = price;
        trades.push({ index: i, time: new Date(candles[i].datetime).getTime(), side: 'buy', price, shares: raw, fee, cashAfter: cash });
      }
    } else if (side === 'sell' && shares > 0) {
      const proceeds = shares * price;
      const fee = proceeds * feeRate;
      cash += proceeds - fee;
      trades.push({ index: i, time: new Date(candles[i].datetime).getTime(), side: 'sell', price, shares, fee, cashAfter: cash });
      shares = 0;
      avgCost = 0;
      peak = 0;
    } else if (shares > 0 && price > peak) {
      peak = price; // 持仓浮盈刷新移动止损基准
    }

    const eq = cash + shares * price;
    equity.push(eq);
  }

  const finalEquity = equity.length ? equity[equity.length - 1] : initCash;
  const totalReturnPct = initCash > 0 ? ((finalEquity - initCash) / initCash) * 100 : 0;

  // 胜率：按平仓配对（简化为有卖单则计数一次盈利/亏损）
  const sells = trades.filter((t) => t.side === 'sell');
  let wins = 0;
  for (const s of sells) {
    // 用开仓均价近似：买在 avgCost 逻辑已重置，这里用上一笔 buy 价
    const prevBuy = [...trades].reverse().find((t) => t.side === 'buy' && t.index < s.index);
    if (prevBuy && s.price > prevBuy.price) wins++;
  }
  const winRate = sells.length ? (wins / sells.length) * 100 : 0;

  return {
    trades,
    equity,
    initCash,
    finalEquity,
    totalReturnPct,
    maxDrawdownPct: maxDrawdown(equity),
    sharpe: sharpe(equity),
    winRate,
  };
}
