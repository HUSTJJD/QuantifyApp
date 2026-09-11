/**
 * 多因子策略框架单测：因子语义、规则引擎、内置模板。
 */
import type { Candle } from '@/data/api';
import { FACTORS, getFactor, defaultFactorParams } from '@/strategies/factors';
import { evaluateStrategy } from '@/strategies/engine';
import { STRATEGY_TEMPLATES, DEFAULT_TEMPLATE_ID, getTemplate } from '@/strategies/templates';

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

/** 构造 MA 金叉 + 放量序列 */
function goldenCross(): Candle[] {
  const base = Array.from({ length: 40 }, (_, i) => 100 - i * 0.3);
  base.push(120);
  const vols = base.map((_, i) => (i === base.length - 1 ? 5000 : 1000));
  return mk(base, vols);
}

describe('因子注册表', () => {
  it('包含 7 个因子且 id 唯一', () => {
    expect(FACTORS.length).toBe(7);
    const ids = FACTORS.map((f) => f.id);
    expect(new Set(ids).size).toBe(7);
    expect(ids).toEqual(
      expect.arrayContaining(['ma_cross', 'macd', 'rsi', 'volume_ratio', 'breakout', 'bollinger', 'ma_trend']),
    );
  });

  it('每个因子有 params 定义与默认值', () => {
    for (const f of FACTORS) {
      expect(f.params.length).toBeGreaterThan(0);
      const d = defaultFactorParams(f);
      for (const p of f.params) {
        expect(typeof d[p.key]).toBe('number');
      }
    }
  });

  it('getFactor 能取到', () => {
    expect(getFactor('ma_cross')?.label).toBe('均线交叉');
    expect(getFactor('nope')).toBeUndefined();
  });
});

describe('因子语义', () => {
  const candles = goldenCross();

  it('ma_cross 金叉 triggered=buy', () => {
    const f = getFactor('ma_cross')!;
    const r = f.evaluate(candles, defaultFactorParams(f));
    expect(r?.triggered).toBe(true);
    expect(r?.triggerSide).toBe('buy');
    expect(r?.score).toBe(1);
  });

  it('volume_ratio 放量 score>0', () => {
    const f = getFactor('volume_ratio')!;
    const r = f.evaluate(candles, defaultFactorParams(f));
    expect(r).not.toBeNull();
    expect(r!.score).toBeGreaterThan(0);
  });

  it('数据不足返回 null', () => {
    const f = getFactor('ma_cross')!;
    expect(f.evaluate(mk([1, 2, 3]), defaultFactorParams(f))).toBeNull();
  });
});

describe('evaluateStrategy 规则引擎', () => {
  it('and 规则：全部条件满足才触发', () => {
    const tpl = {
      id: 't',
      label: 't',
      description: '',
      rules: [{
        mode: 'and' as const,
        side: 'buy' as const,
        conditions: [
          { kind: 'triggered' as const, factorId: 'ma_cross', side: 'buy' as const },
          { kind: 'score' as const, factorId: 'volume_ratio', op: 'gte' as const, value: 0.3 },
        ],
      }],
    };
    const sig = evaluateStrategy(tpl, goldenCross());
    expect(sig?.side).toBe('buy');
    expect(sig?.strength).toBeGreaterThan(0);
  });

  it('or 规则：任一满足即触发', () => {
    const tpl = {
      id: 't',
      label: 't',
      description: '',
      rules: [{
        mode: 'or' as const,
        side: 'sell' as const,
        conditions: [
          // 上涨序列 RSI 高 → score 为负（超买）
          { kind: 'score' as const, factorId: 'rsi', op: 'lt' as const, value: -0.5 },
          { kind: 'score' as const, factorId: 'macd', op: 'lt' as const, value: -0.99 },
        ],
      }],
    };
    const rsiUp = Array.from({ length: 60 }, (_, i) => 100 + i);
    const sig = evaluateStrategy(tpl, mk(rsiUp));
    expect(sig?.side).toBe('sell');
  });

  it('不命中返回 null', () => {
    const tpl = {
      id: 't',
      label: 't',
      description: '',
      rules: [{
        mode: 'and' as const,
        side: 'buy' as const,
        conditions: [
          { kind: 'score' as const, factorId: 'rsi', op: 'lt' as const, value: -0.99 },
        ],
      }],
    };
    expect(evaluateStrategy(tpl, mk(Array.from({ length: 60 }, (_, i) => 100 + i)))).toBeNull();
  });
});

describe('内置模板', () => {
  it('有 3 个模板，默认 trend_confirm', () => {
    expect(STRATEGY_TEMPLATES.length).toBe(3);
    expect(DEFAULT_TEMPLATE_ID).toBe('trend_confirm');
    expect(getTemplate(DEFAULT_TEMPLATE_ID)?.label).toBe('趋势确认');
  });

  it('每个模板有 buy 和 sell 规则', () => {
    for (const t of STRATEGY_TEMPLATES) {
      const sides = t.rules.map((r) => r.side);
      expect(sides).toContain('buy');
      expect(sides).toContain('sell');
      expect(t.description.length).toBeGreaterThan(10);
    }
  });

  it('模板可评估且不抛错', () => {
    const data = goldenCross();
    for (const t of STRATEGY_TEMPLATES) {
      const r = evaluateStrategy(t, data);
      if (r) expect(['buy', 'sell']).toContain(r.side);
    }
  });
});
