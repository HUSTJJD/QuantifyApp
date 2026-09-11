/**
 * 组合策略引擎单测：多指标 AND/OR、交叉、量比、预置模板。
 */
import { evaluateComposite, buildSnapshot, evalCondition, COMPOSITE_PRESETS } from '@/quant/composite';
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

/** 构造 MA5 上穿 MA20 的序列：先 MA20>MA5，最后一根跳升使 MA5 上穿 */
function goldenCrossCandles(): Candle[] {
  // 前段平缓下跌后横盘，最后一根大涨
  const base = Array.from({ length: 40 }, (_, i) => 100 - i * 0.3);
  base.push(120); // 最后一根暴涨，MA5 上穿 MA20
  const vols = base.map((_, i) => (i === base.length - 1 ? 5000 : 1000));
  return mk(base, vols);
}

describe('composite.buildSnapshot', () => {
  it('K 线不足返回 null', () => {
    expect(buildSnapshot(mk([1, 2]))).not.toBeNull(); // 2 根可建
    expect(buildSnapshot(mk([1]))).toBeNull();
  });

  it('能读出 close / rsi14 / ma20', () => {
    const snap = buildSnapshot(mk(Array.from({ length: 60 }, (_, i) => 100 + i)));
    expect(snap).not.toBeNull();
    expect(snap!.get('close')).toBeCloseTo(100 + 59);
    expect(snap!.get('rsi14')).not.toBeNull();
    expect(snap!.get('ma20')).not.toBeNull();
  });
});

describe('composite.evalCondition', () => {
  const snap = buildSnapshot(mk(Array.from({ length: 60 }, (_, i) => 100 + i)))!;

  it('compare 数值比较', () => {
    expect(evalCondition({ kind: 'compare', indicator: 'close', op: '>', value: 100 }, snap)).toBe(true);
    expect(evalCondition({ kind: 'compare', indicator: 'close', op: '<', value: 100 }, snap)).toBe(false);
  });

  it('compare_ind 指标比较', () => {
    // 上升趋势：close > ma20
    expect(evalCondition({ kind: 'compare_ind', left: 'close', op: '>', right: 'ma20' }, snap)).toBe(true);
  });

  it('cross_above 交叉', () => {
    const golden = buildSnapshot(goldenCrossCandles())!;
    expect(evalCondition({ kind: 'cross_above', left: 'ma5', right: 'ma20' }, golden)).toBe(true);
  });
});

describe('composite.evaluateComposite', () => {
  it('and 规则：全部条件满足才触发', () => {
    const def = {
      id: 't',
      label: 't',
      rules: [{
        mode: 'and' as const,
        side: 'buy' as const,
        conditions: [
          { kind: 'cross_above' as const, left: 'ma5' as const, right: 'ma20' as const },
          { kind: 'vol_ratio' as const, op: '>=' as const, value: 1.2 },
        ],
      }],
    };
    const hit = evaluateComposite(def, goldenCrossCandles());
    expect(hit?.side).toBe('buy');
    expect(hit?.strength).toBeGreaterThan(0);
  });

  it('or 规则：任一条件满足即触发', () => {
    const def = {
      id: 't',
      label: 't',
      rules: [{
        mode: 'or' as const,
        side: 'buy' as const,
        conditions: [
          { kind: 'compare' as const, indicator: 'rsi14' as const, op: '<' as const, value: 30 },
          { kind: 'compare' as const, indicator: 'close' as const, op: '>' as const, value: 0 },
        ],
      }],
    };
    // close>0 必然满足
    const hit = evaluateComposite(def, mk(Array.from({ length: 60 }, (_, i) => 10 + i)));
    expect(hit?.side).toBe('buy');
  });

  it('预置模板可评估且不抛错', () => {
    const candles = goldenCrossCandles();
    for (const preset of COMPOSITE_PRESETS) {
      const r = evaluateComposite(preset, candles);
      // 可能命中也可能不命中，关键是不抛错且类型正确
      if (r) expect(['buy', 'sell']).toContain(r.side);
    }
  });
});
