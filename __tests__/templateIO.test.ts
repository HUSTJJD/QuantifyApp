import { exportTemplate, importTemplate, validateTemplate } from '@/strategies/templateIO';
import type { StrategyTemplate } from '@/strategies/types';

const validTemplate: StrategyTemplate = {
  id: 'test_strategy',
  label: '测试策略',
  description: '用于单测',
  rules: [
    {
      mode: 'and',
      side: 'buy',
      strength: 2,
      conditions: [
        { kind: 'triggered', factorId: 'ma_cross', side: 'buy' },
        { kind: 'score', factorId: 'rsi', op: 'lt', value: 60 },
      ],
    },
  ],
};

describe('exportTemplate', () => {
  it('导出为合法 JSON', () => {
    const json = exportTemplate(validTemplate);
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe('test_strategy');
    expect(parsed.rules).toHaveLength(1);
  });
});

describe('validateTemplate', () => {
  it('合法模板无错误', () => {
    expect(validateTemplate(validTemplate)).toHaveLength(0);
  });

  it('空 rules 报错', () => {
    const t = { ...validTemplate, rules: [] };
    expect(validateTemplate(t).some((e) => e.includes('rules'))).toBe(true);
  });

  it('未知因子报错', () => {
    const t: StrategyTemplate = {
      ...validTemplate,
      rules: [
        {
          mode: 'and',
          side: 'buy',
          conditions: [{ kind: 'score', factorId: 'nonexistent', op: 'gt', value: 0 }],
        },
      ],
    };
    expect(validateTemplate(t).some((e) => e.includes('nonexistent'))).toBe(true);
  });

  it('非法 op 报错', () => {
    const t: StrategyTemplate = {
      ...validTemplate,
      rules: [
        {
          mode: 'and',
          side: 'buy',
          conditions: [{ kind: 'score', factorId: 'rsi', op: 'equals' as any, value: 0 }],
        },
      ],
    };
    expect(validateTemplate(t).some((e) => e.includes('操作符'))).toBe(true);
  });

  it('未知条件类型报错', () => {
    const t: any = {
      ...validTemplate,
      rules: [
        { mode: 'and', side: 'buy', conditions: [{ kind: 'mystery' }] },
      ],
    };
    expect(validateTemplate(t).some((e) => e.includes('mystery'))).toBe(true);
  });

  it('null 输入返回错误', () => {
    expect(validateTemplate(null)).toHaveLength(1);
  });
});

describe('importTemplate', () => {
  it('合法 JSON 导入成功', () => {
    const json = exportTemplate(validTemplate);
    const r = importTemplate(json);
    expect(r.ok).toBe(true);
    expect(r.template?.id).toBe('test_strategy');
  });

  it('非法 JSON 返回解析错误', () => {
    const r = importTemplate('not json');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('解析');
  });

  it('结构非法返回校验错误', () => {
    const r = importTemplate('{"id":"","label":"","rules":[]}');
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('roundtrip：导出→导入→导出一致', () => {
    const json1 = exportTemplate(validTemplate);
    const r = importTemplate(json1);
    const json2 = exportTemplate(r.template!);
    expect(json1).toBe(json2);
  });
});
