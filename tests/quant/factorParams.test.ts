import { evaluateStrategy, factorsUsedBy } from '@/quant/core/engine';
import { getTemplate } from '@/quant/core/templates';
import { getFactor, defaultFactorParams } from '@/quant/core/factors';

describe('factor params', () => {
  it('templates reference existing factors with param metadata', () => {
    const tpl = getTemplate('trend_confirm');
    if (!tpl) return;
    for (const fid of factorsUsedBy(tpl)) {
      const f = getFactor(fid);
      expect(f).toBeTruthy();
      expect(Object.keys(defaultFactorParams(f!)).length).toBe(f!.params.length);
    }
  });

  it('param overrides are accepted by evaluateStrategy', () => {
    const tpl = getTemplate('trend_confirm')!;
    expect(() => evaluateStrategy(tpl, [], { ma_cross: { fast: 5 } })).not.toThrow();
  });
});
