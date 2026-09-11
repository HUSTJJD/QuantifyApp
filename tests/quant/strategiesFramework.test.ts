/**
 * 多因子框架：因子注册表 / 模板 / 评估引擎。
 */
import { FACTORS, getFactor, defaultFactorParams } from '@/quant/core/factors';
import { evaluateStrategy } from '@/quant/core/engine';
import { STRATEGY_TEMPLATES, DEFAULT_TEMPLATE_ID, getTemplate } from '@/quant/core/templates';
import type { Candle } from '@/data/api';

const empty: Candle[] = [];

describe('strategies framework', () => {
  it('exports factors and templates', () => {
    expect(FACTORS.length).toBeGreaterThan(0);
    expect(STRATEGY_TEMPLATES.length).toBeGreaterThan(0);
    expect(getTemplate(DEFAULT_TEMPLATE_ID)?.id).toBe(DEFAULT_TEMPLATE_ID);
  });

  it('factor evaluate handles empty candles', () => {
    for (const f of FACTORS) {
      const r = f.evaluate(empty, defaultFactorParams(f));
      expect(r === null || typeof r.score === 'number').toBe(true);
    }
  });

  it('evaluateStrategy on empty candles returns null', () => {
    const tpl = getTemplate(DEFAULT_TEMPLATE_ID)!;
    expect(evaluateStrategy(tpl, empty)).toBeNull();
  });

  it('getFactor returns undefined for unknown id', () => {
    expect(getFactor('__nope__')).toBeUndefined();
  });
});
