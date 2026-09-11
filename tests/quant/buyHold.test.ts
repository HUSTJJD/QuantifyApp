/**
 * 买入持有基准单测。
 *
 * 重点：买入持有必须与策略回测**同口径**（同费用模型、同撮合时机、同除权处理），
 * 否则「策略是否跑赢简单持有」的结论不成立。
 */
import { runBuyHold, excessVsBuyHold } from '@/quant/buyHold';
import type { Candle } from '@/data/api';

function series(prices: number[], open?: number[]): Candle[] {
  return prices.map((p, i) => ({
    datetime: i,
    open: open?.[i] ?? p,
    high: p,
    low: p,
    close: p,
    volume: 1000,
  }));
}

const ZERO_COST = {
  commissionRate: 0,
  minCommission: 0,
  stampTaxRate: 0,
  transferFeeRate: 0,
};

describe('runBuyHold', () => {
  it('上涨序列收益为正且权益等长', () => {
    const r = runBuyHold(series([100, 110, 120]), { initCash: 100_000 });
    expect(r.equity).toHaveLength(3);
    // 默认按 A 股费用模型扣费：全仓 1000 股需 100026 元 > 本金，回退到 900 股
    expect(r.shares).toBe(900);
    expect(r.buyFee).toBeGreaterThan(0);
    expect(r.totalReturnPct).toBeGreaterThan(15);
  });

  it('零成本模式下恢复「收益 ≈ 价格涨幅」的直觉校验', () => {
    const r = runBuyHold(series([100, 110, 120]), { initCash: 100_000, cost: ZERO_COST });
    expect(r.shares).toBe(1000);
    expect(r.buyFee).toBe(0);
    expect(r.totalReturnPct).toBeCloseTo(20, 4);
  });

  it('空序列 / 无效本金安全', () => {
    expect(runBuyHold([], { initCash: 100_000 }).totalReturnPct).toBe(0);
    expect(runBuyHold(series([10, 11]), { initCash: 0 }).shares).toBe(0);
  });

  it('nextOpen 建仓用次日开盘价，且与策略同撮合口径', () => {
    const cs = series([100, 110, 120], [100, 108, 118]);
    const closeRun = runBuyHold(cs, { initCash: 100_000, cost: ZERO_COST });
    const openRun = runBuyHold(cs, { initCash: 100_000, cost: ZERO_COST, execution: 'nextOpen' });
    expect(closeRun.buyPrice).toBe(100);
    expect(openRun.buyPrice).toBe(108); // 次日开盘
    expect(openRun.equity[0]).toBe(100_000); // 首根尚未建仓
    expect(openRun.totalReturnPct).toBeLessThan(closeRun.totalReturnPct);
  });

  it('仅一根 K 线时 nextOpen 不虚构建仓', () => {
    const r = runBuyHold(series([100]), { initCash: 100_000, execution: 'nextOpen' });
    expect(r.shares).toBe(0);
    expect(r.reason).toContain('nextOpen');
  });

  it('资金不足一手时如实返回未成交，而不是假装全仓', () => {
    const r = runBuyHold(series([10, 12]), { initCash: 50 });
    expect(r.shares).toBe(0);
    expect(r.reason).toContain('不足一手');
    expect(r.equity.every((v) => v === 50)).toBe(true);
  });

  it('10送10：按除权拿股，不能算成暴跌（否则会伪造策略超额收益）', () => {
    const cs = series([10, 10, 5, 5]);
    const r = runBuyHold(cs, {
      initCash: 2000,
      execution: 'close',
      corporateActions: [{ exDateMs: 2, perShareBonus: 1 }],
    });
    expect(r.shares).toBe(200); // 送股后翻倍
    expect(r.corpEvents).toHaveLength(1);
    expect(r.totalReturnPct).toBeGreaterThan(-1); // 只承担手续费
  });

  it('分红进现金：不平仓也能体现股息收益', () => {
    const cs = series([10, 10, 10, 10]);
    const noDiv = runBuyHold(cs, { initCash: 2000, cost: ZERO_COST });
    const withDiv = runBuyHold(cs, {
      initCash: 2000,
      cost: ZERO_COST,
      corporateActions: [{ exDateMs: 2, dividendPerShare: 0.5 }],
    });
    expect(noDiv.totalReturnPct).toBeCloseTo(0, 4);
    expect(noDiv.shares).toBe(200);
    // 200 股 × 0.5 = 100 元，占本金 5%
    expect(withDiv.totalReturnPct).toBeCloseTo(5, 4);
  });

  it('超额 = 策略 - 买入持有', () => {
    expect(excessVsBuyHold(15, 20)).toBeCloseTo(-5);
  });
});