/**
 * 档案模型与多因子模板核心测试。
 */
import { evaluateProfile, createProfile, combineSignals } from '@/quant/profile';
import { STRATEGY_TEMPLATES, DEFAULT_TEMPLATE_ID, getTemplate } from '@/quant/core/templates';
import { FACTORS, getFactor, defaultFactorParams } from '@/quant/core/factors';
import { evaluateStrategy, factorsUsedBy } from '@/quant/core/engine';
import type { Candle } from '@/data/api';

function candles(n = 80, start = 10): Candle[] {
  const out: Candle[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const open = p;
    const close = p * (1 + (i % 7 === 0 ? 0.02 : -0.005));
    const high = Math.max(open, close) * 1.01;
    const low = Math.min(open, close) * 0.99;
    out.push({
      open, high, low, close,
      volume: 1000 + i * 10,
      amount: close * (1000 + i * 10),
      datetime: new Date(2024, 0, 1 + i).toISOString(),
    } as Candle);
    p = close;
  }
  return out;
}

describe('quant/core templates', () => {
  it('registers built-in templates including default', () => {
    expect(STRATEGY_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    expect(getTemplate(DEFAULT_TEMPLATE_ID)).toBeTruthy();
  });

  it('evaluates a template without throwing', () => {
    const tpl = getTemplate(DEFAULT_TEMPLATE_ID)!;
    const sig = evaluateStrategy(tpl, candles());
    // 可能 null（未命中规则），但不应抛错
    expect(sig === null || typeof sig.strength === 'number').toBe(true);
  });

  it('lists factors used by a template', () => {
    const tpl = getTemplate(DEFAULT_TEMPLATE_ID)!;
    const ids = factorsUsedBy(tpl);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(getFactor(id)).toBeTruthy();
  });
});

describe('strategy profile model', () => {
  it('creates profile with legs + combineMode (no signal kernel)', () => {
    const p = createProfile([DEFAULT_TEMPLATE_ID]);
    expect(p.legs.length).toBe(1);
    expect(p.legs[0].templateId).toBe(DEFAULT_TEMPLATE_ID);
    expect(p.combineMode).toBe('and');
    expect((p as { templateId?: string }).templateId).toBeUndefined();
  });

  it('evaluateProfile returns null or PartialSignal', () => {
    const p = createProfile([DEFAULT_TEMPLATE_ID], { combineMode: 'or' });
    const sig = evaluateProfile(p, candles());
    expect(sig === null || ['buy', 'sell', 'hold'].includes(sig!.side)).toBe(true);
  });

  it('combineSignals and/or/vote', () => {
    const buy = { side: 'buy' as const, reason: 'a', strength: 2 };
    const sell = { side: 'sell' as const, reason: 'b', strength: 1 };
    // and：有效信号必须同侧；空腿不计入
    expect(combineSignals([buy, null], [1, 1], 'and')?.side).toBe('buy');
    expect(combineSignals([buy, sell], [1, 1], 'and')).toBeNull();
    expect(combineSignals([buy, null], [1, 1], 'or')?.side).toBe('buy');
    expect(combineSignals([buy, sell], [2, 1], 'vote')?.side).toBe('buy');
  });
});

describe('factors registry', () => {
  it('has default params for each factor', () => {
    expect(FACTORS.length).toBeGreaterThan(0);
    for (const f of FACTORS) {
      const params = defaultFactorParams(f);
      for (const p of f.params) {
        expect(typeof params[p.key]).toBe('number');
      }
    }
  });
});
