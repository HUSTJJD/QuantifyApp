/**
 * 参数扫描辅助：从因子参数元数据生成紧凑网格，并在档案上注入参数构造 Strategy。
 * 网格刻意做小（最多 2 个键 × 各 3 候选），避免移动端组合爆炸。
 */
import type { ParamSpec, StrategyProfile } from './profile';
import { strategyOfProfile } from './profile';
import type { ParamGrid, ParamCombo } from './optimize';
import type { Strategy } from './strategies';

/** 在当前值附近取 3 个候选（含当前），并夹在 min/max 内。 */
export function candidatesAround(spec: ParamSpec, current: number): number[] {
  const step = spec.step && spec.step > 0 ? spec.step : 1;
  const lo = spec.min ?? current - step;
  const hi = spec.max ?? current + step;
  const vals = [current - step, current, current + step]
    .map((v) => Math.round(v / step) * step)
    .map((v) => Math.min(hi, Math.max(lo, v)));
  return [...new Set(vals)].sort((a, b) => a - b);
}

/**
 * 生成参数扫描网格：取前 maxKeys 个有变化空间的参数。
 * 无可用参数返回 null。
 */
export function buildScanGrid(
  specs: ParamSpec[],
  current: Record<string, number>,
  maxKeys = 2,
): ParamGrid | null {
  const grid: ParamGrid = {};
  for (const s of specs) {
    if (Object.keys(grid).length >= maxKeys) break;
    const cur = current[s.key];
    if (cur == null || !Number.isFinite(cur)) continue;
    const cands = candidatesAround(s, cur);
    if (cands.length > 1) grid[s.key] = cands;
  }
  return Object.keys(grid).length > 0 ? grid : null;
}

/** 用一组扁平参数覆盖档案，构造可回测的 Strategy。 */
export function strategyWithParams(profile: StrategyProfile, params: ParamCombo): Strategy {
  return strategyOfProfile({ ...profile, params: { ...profile.params, ...params } });
}

/** 把参数组合渲染成可读短标签（只显示扫描过的键）。 */
export function formatParamCombo(params: ParamCombo): string {
  const parts = Object.entries(params).map(([k, v]) => {
    const short = k.includes('.') ? k.slice(k.indexOf('.') + 1) : k;
    return `${short}=${v}`;
  });
  return parts.length ? parts.join(' · ') : '默认';
}
