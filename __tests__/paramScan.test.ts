import { candidatesAround, buildScanGrid, formatParamCombo, strategyWithParams } from '@/quant/paramScan';
import { paramGroupsOf, paramSpecsOf, createProfileFromTemplate } from '@/quant/profile';
import type { ParamSpec } from '@/quant/profile';

describe('paramGroupsOf', () => {
  it('趋势确认模板按因子分组，且含 ma_cross / rsi 等', () => {
    const groups = paramGroupsOf('trend_confirm');
    expect(groups.length).toBeGreaterThan(0);
    const ids = groups.map((g) => g.factorId);
    expect(ids).toContain('ma_cross');
    expect(ids).toContain('rsi');
    for (const g of groups) {
      expect(g.specs.length).toBeGreaterThan(0);
      for (const s of g.specs) {
        expect(s.key.startsWith(`${g.factorId}.`)).toBe(true);
        expect(s.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('paramSpecsOf 扁平结果与分组一致且 label 带因子前缀', () => {
    const groups = paramGroupsOf('trend_confirm');
    const flat = paramSpecsOf('trend_confirm');
    const expected = groups.reduce((n, g) => n + g.specs.length, 0);
    expect(flat).toHaveLength(expected);
    const ma = flat.find((s) => s.key.startsWith('ma_cross.'));
    expect(ma?.label).toContain('·');
  });

  it('未知模板返回空', () => {
    expect(paramGroupsOf('no_such_template')).toEqual([]);
  });
});

describe('candidatesAround', () => {
  const spec: ParamSpec = { key: 'ma_cross.fast', label: '快线', min: 3, max: 20, step: 1 };

  it('当前值邻域 ±step，夹在 min/max', () => {
    expect(candidatesAround(spec, 5)).toEqual([4, 5, 6]);
    expect(candidatesAround(spec, 3)).toEqual([3, 4]);
    expect(candidatesAround(spec, 20)).toEqual([19, 20]);
  });

  it('step>1 时按步长对齐', () => {
    const s: ParamSpec = { key: 'x', label: 'x', min: 0, max: 20, step: 5 };
    expect(candidatesAround(s, 10)).toEqual([5, 10, 15]);
  });
});

describe('buildScanGrid', () => {
  const specs: ParamSpec[] = [
    { key: 'ma_cross.fast', label: '快线', min: 3, max: 20, step: 1 },
    { key: 'ma_cross.slow', label: '慢线', min: 10, max: 60, step: 1 },
    { key: 'rsi.period', label: 'RSI周期', min: 6, max: 24, step: 1 },
  ];

  it('最多取 2 个键，每个 3 候选', () => {
    const grid = buildScanGrid(specs, { 'ma_cross.fast': 5, 'ma_cross.slow': 20, 'rsi.period': 14 }, 2);
    expect(grid).not.toBeNull();
    expect(Object.keys(grid!)).toHaveLength(2);
    expect(grid!['ma_cross.fast']).toEqual([4, 5, 6]);
  });

  it('缺当前值的参数跳过', () => {
    const grid = buildScanGrid(specs, { 'rsi.period': 14 }, 2);
    expect(grid).toEqual({ 'rsi.period': [13, 14, 15] });
  });

  it('无可用参数返回 null', () => {
    expect(buildScanGrid(specs, {}, 2)).toBeNull();
  });
});

describe('strategyWithParams / formatParamCombo', () => {
  it('构造的 strategy 可 evaluate 且参数覆盖生效', () => {
    const profile = createProfileFromTemplate('trend_confirm');
    const strat = strategyWithParams(profile, { 'ma_cross.fast': 3 });
    expect(typeof strat.evaluate).toBe('function');
    // 空 K 线应返回 null，不抛错
    expect(strat.evaluate([], {})).toBeNull();
  });

  it('formatParamCombo 只保留短键名', () => {
    expect(formatParamCombo({ 'ma_cross.fast': 5, 'rsi.period': 14 })).toBe('fast=5 · period=14');
    expect(formatParamCombo({})).toBe('默认');
  });
});
