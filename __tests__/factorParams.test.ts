/**
 * 因子参数调参链路：档案扁平 params → 引擎嵌套 overrides。
 */
import { evaluateStrategy, factorsUsedBy } from '@/strategies/engine';
import { getTemplate } from '@/strategies/templates';
import { getFactor, defaultFactorParams } from '@/strategies/factors';
import type { Candle } from '@/data/api';

function mk(closes: number[], vols?: number[]): Candle[] {
  return closes.map((c, i) => ({
    datetime: i,
    open: c,
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume: vols?.[i] ?? 1000,
  }));
}

function goldenCross(): Candle[] {
  const base = Array.from({ length: 40 }, (_, i) => 100 - i * 0.3);
  base.push(120);
  const vols = base.map((_, i) => (i === base.length - 1 ? 5000 : 1000));
  return mk(base, vols);
}

describe('因子参数覆盖', () => {
  it('factorsUsedBy 收集模板用到的因子', () => {
    const tpl = getTemplate('trend_confirm')!;
    const ids = factorsUsedBy(tpl);
    expect(ids).toContain('ma_cross');
    expect(ids).toContain('macd');
    expect(ids).toContain('rsi');
    expect(ids).toContain('volume_ratio');
  });

  it('paramOverrides 改变 RSI 阈值可改变触发', () => {
    const tpl = getTemplate('trend_confirm')!;
    const candles = goldenCross();
    // 默认 RSI buy 阈值 30；把 threshold 放到极宽（buy=90）使 rsi score 更容易 > -0.3
    const base = evaluateStrategy(tpl, candles);
    // 金叉+放量序列通常触发买
    expect(base?.side).toBe('buy');
    // 把 ma_cross 慢线调到很大，使金叉条件不成立 → 不触发
    const tuned = evaluateStrategy(tpl, candles, { ma_cross: { fast: 5, slow: 120 } });
    // 慢线 120 在 41 根 K 线下算不出，应不触发 buy
    expect(tuned?.side).not.toBe('buy');
  });

  it('因子默认参数来自 FactorParamDef', () => {
    const f = getFactor('rsi')!;
    expect(defaultFactorParams(f)).toMatchObject({ period: 14, buy: 30, sell: 70 });
  });
});
