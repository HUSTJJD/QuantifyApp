/**
 * 策略模板导入/导出：JSON 序列化 + 校验。
 *
 * 纯函数，不依赖 UI / 存储：
 *  - `exportTemplate`：StrategyTemplate → JSON 字符串
 *  - `importTemplate`：JSON 字符串 → StrategyTemplate（校验因子 id 合法性）
 *  - `validateTemplate`：结构校验，返回错误列表
 */
import type { StrategyTemplate } from './types';
import { FACTORS } from './factors';

const VALID_FACTOR_IDS = new Set(FACTORS.map((f) => f.id));
const VALID_OPS = new Set(['gt', 'lt', 'gte', 'lte']);
const VALID_MODES = new Set(['and', 'or']);
const VALID_SIDES = new Set(['buy', 'sell']);

/** 导出为 JSON 字符串（美化格式） */
export function exportTemplate(t: StrategyTemplate): string {
  return JSON.stringify(t, null, 2);
}

/** 校验单条条件 */
function validateCondition(c: unknown, path: string, errors: string[]): void {
  if (typeof c !== 'object' || c === null) {
    errors.push(`${path}: 条件必须是对象`);
    return;
  }
  const cond = c as Record<string, unknown>;
  const kind = cond.kind;
  if (kind === 'score') {
    if (typeof cond.factorId !== 'string' || !VALID_FACTOR_IDS.has(cond.factorId)) {
      errors.push(`${path}: 未知因子 "${String(cond.factorId)}"`);
    }
    if (typeof cond.op !== 'string' || !VALID_OPS.has(cond.op)) {
      errors.push(`${path}: 非法操作符 "${String(cond.op)}"`);
    }
    if (typeof cond.value !== 'number' || !Number.isFinite(cond.value)) {
      errors.push(`${path}: value 必须是数字`);
    }
  } else if (kind === 'triggered') {
    if (typeof cond.factorId !== 'string' || !VALID_FACTOR_IDS.has(cond.factorId)) {
      errors.push(`${path}: 未知因子 "${String(cond.factorId)}"`);
    }
    if (cond.side !== 'buy' && cond.side !== 'sell') {
      errors.push(`${path}: side 必须是 buy/sell`);
    }
  } else if (kind === 'cross') {
    if (typeof cond.left !== 'string' || !VALID_FACTOR_IDS.has(cond.left)) {
      errors.push(`${path}: left 未知因子 "${String(cond.left)}"`);
    }
    if (typeof cond.right !== 'string' || !VALID_FACTOR_IDS.has(cond.right)) {
      errors.push(`${path}: right 未知因子 "${String(cond.right)}"`);
    }
    if (cond.direction !== 'above' && cond.direction !== 'below') {
      errors.push(`${path}: direction 必须是 above/below`);
    }
  } else {
    errors.push(`${path}: 未知条件类型 "${String(kind)}"`);
  }
}

/** 校验模板结构，返回错误列表（空 = 合法） */
export function validateTemplate(t: unknown): string[] {
  const errors: string[] = [];
  if (typeof t !== 'object' || t === null) return ['模板必须是对象'];

  const obj = t as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !obj.id) errors.push('id 不能为空');
  if (typeof obj.label !== 'string' || !obj.label) errors.push('label 不能为空');
  if (!Array.isArray(obj.rules) || obj.rules.length === 0) {
    errors.push('rules 不能为空');
    return errors;
  }

  obj.rules.forEach((r, i) => {
    const path = `rules[${i}]`;
    if (typeof r !== 'object' || r === null) {
      errors.push(`${path}: 必须是对象`);
      return;
    }
    const rule = r as Record<string, unknown>;
    if (typeof rule.mode !== 'string' || !VALID_MODES.has(rule.mode)) {
      errors.push(`${path}.mode: 非法值 "${String(rule.mode)}"`);
    }
    if (rule.side !== 'buy' && rule.side !== 'sell') {
      errors.push(`${path}.side: 必须是 buy/sell`);
    }
    if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) {
      errors.push(`${path}.conditions: 不能为空`);
    } else {
      rule.conditions.forEach((c, j) => validateCondition(c, `${path}.conditions[${j}]`, errors));
    }
  });

  return errors;
}

export interface ImportResult {
  ok: boolean;
  template?: StrategyTemplate;
  errors: string[];
}

/** 导入 JSON 字符串 → StrategyTemplate（含校验） */
export function importTemplate(json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, errors: ['JSON 解析失败'] };
  }
  const errors = validateTemplate(parsed);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, template: parsed as StrategyTemplate, errors: [] };
}
