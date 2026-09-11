/**
 * 买入持有基准：同一段 K 线、初始资金全仓买入并持有到期。
 * 用于回答「策略是否跑赢简单拿着这只票」。
 *
 * 可比性（重要）：过去这里直接 `(末收 − 首收)` 且不计费用、不处理除权，
 * 导致两条曲线口径不一致——
 *   1. 策略扣了佣金/印花税，买入持有不扣 → 系统性低估策略；
 *   2. 策略在不复权 K 线上按 raw-events 拿到送股/分红，买入持有拿不到 →
 *      10 送 10 会被算成「买入持有 -50%」，制造虚假超额收益。
 * 因此这里复用回测引擎的 `planBuy`（费用+整手约束）与 `applyCorpActionsAtBar`
 * （除权调整），保证对照成立。
 */
import type { Candle } from '@/data/api';
import type { AdjustmentFactorInput } from './adjustment';
import {
  applyCorpActionsAtBar,
  DEFAULT_COST,
  planBuy,
  timeOf,
  type CorpEventLog,
  type CostModel,
  type PosState,
} from './backtest';

export interface BuyHoldMetrics {
  /** 买入持有总收益 % */
  totalReturnPct: number;
  /** 权益序列（与 candles 等长；建仓前为现金） */
  equity: number[];
  /** 首日可买股数（整手） */
  shares: number;
  buyPrice: number;
  /** 建仓手续费（0 表示未成交） */
  buyFee: number;
  /** 除权事件（分红/送转/配股）日志 */
  corpEvents: CorpEventLog[];
  /** 未成交原因（如资金不足一手） */
  reason?: string;
}

export interface BuyHoldOptions {
  initCash?: number;
  /** 整手基数，默认 100 */
  lotSize?: number;
  /** 成本模型，部分覆盖 DEFAULT_COST */
  cost?: Partial<CostModel>;
  /**
   * 公司行为（分红/送转/配股），与回测同源。
   * 在「不复权 + raw-events」链路下**必须**传入，否则除权日会被算成暴跌。
   */
  corporateActions?: AdjustmentFactorInput[];
  /** 建仓时机：close（首根收盘）| nextOpen（次根开盘，与回测默认口径一致） */
  execution?: 'close' | 'nextOpen';
}

function empty(initCash: number, candles: Candle[], reason: string): BuyHoldMetrics {
  return {
    totalReturnPct: 0,
    equity: candles.map(() => initCash),
    shares: 0,
    buyPrice: 0,
    buyFee: 0,
    corpEvents: [],
    reason,
  };
}

export function runBuyHold(
  candles: Candle[],
  opts: BuyHoldOptions = {},
): BuyHoldMetrics {
  const initCash = opts.initCash ?? 100_000;
  const lotSize = opts.lotSize ?? 100;
  const cost: CostModel = { ...DEFAULT_COST, ...opts.cost };
  const actions = opts.corporateActions ?? [];
  const nextOpen = opts.execution === 'nextOpen';

  if (candles.length === 0 || initCash <= 0) {
    return { totalReturnPct: 0, equity: [], shares: 0, buyPrice: 0, buyFee: 0, corpEvents: [] };
  }

  const entryIdx = nextOpen ? 1 : 0;
  if (entryIdx >= candles.length) {
    return empty(initCash, candles, '仅 1 根 K 线，nextOpen 无法次日建仓');
  }

  const buyBar = candles[entryIdx];
  const buyPrice = (nextOpen ? buyBar.open : buyBar.close) || buyBar.close;
  if (!(buyPrice > 0)) {
    return empty(initCash, candles, '建仓价无效');
  }

  // 与回测同一套整手/费用规划：买不起就如实返回未成交，而不是假装全仓买入
  const plan = planBuy(initCash, buyPrice, 1, lotSize, cost);
  if (!plan || plan.shares <= 0) {
    return empty(initCash, candles, `资金不足一手（需 ${buyPrice * lotSize} 元 + 费用）`);
  }

  const pos: PosState = {
    cash: initCash - plan.amount - plan.fee,
    shares: plan.shares,
    avgCost: buyPrice,
    peak: buyPrice,
  };

  const firstBarTime = timeOf(candles[0]);
  const applied = new Set<number>();
  const corpEvents: CorpEventLog[] = [];
  const equity: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i >= entryIdx && actions.length > 0) {
      const before = corpEvents.length;
      applyCorpActionsAtBar(candles[i], firstBarTime, actions, applied, pos, corpEvents);
      // applyCorpActionsAtBar 以 index=0 占位，这里补上真实 bar 下标
      for (let k = before; k < corpEvents.length; k++) corpEvents[k].index = i;
    }
    if (i < entryIdx) {
      equity.push(initCash);
    } else {
      equity.push(pos.cash + pos.shares * candles[i].close);
    }
  }

  const finalEq = equity[equity.length - 1];
  return {
    totalReturnPct: ((finalEq - initCash) / initCash) * 100,
    equity,
    shares: pos.shares,
    buyPrice,
    buyFee: plan.fee,
    corpEvents,
  };
}

/** 策略相对买入持有的超额收益（百分点） */
export function excessVsBuyHold(strategyReturnPct: number, buyHoldReturnPct: number): number {
  return strategyReturnPct - buyHoldReturnPct;
}
