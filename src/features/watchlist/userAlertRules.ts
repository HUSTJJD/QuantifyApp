/**
 * 用户告警规则持久化：
 *  - 自定义规则（priceAbove/priceBelow/pct 等）整列表存 KV
 *  - 内置默认规则的启用开关（覆盖 DEFAULT_ALERT_RULES 里的 enabled）
 *  - 策略信号告警开关（默认开启；关闭后该策略 buy/sell 不推送）
 */
import { storage } from '@/data/db/storage';
import { DEFAULT_ALERT_RULES, type AlertRule } from './alerts';

const USER_RULES_KEY = 'user_price_alert_rules_v1';
const DEFAULT_ENABLED_KEY = 'alert_default_enabled_v1';
const SIGNAL_ALERT_KEY = 'alert_signal_strategy_enabled_v1';

/** 读取用户自定义规则 */
export async function getUserAlertRules(): Promise<AlertRule[]> {
  const saved = await storage.getObject<AlertRule[]>(USER_RULES_KEY);
  return Array.isArray(saved) ? saved : [];
}

/** 覆盖写入用户自定义规则 */
export async function setUserAlertRules(rules: AlertRule[]): Promise<void> {
  await storage.setObject(USER_RULES_KEY, rules);
}

/** 新增一条用户规则（自动生成 id） */
export async function addUserAlertRule(rule: Omit<AlertRule, 'id'>): Promise<AlertRule> {
  const rules = await getUserAlertRules();
  const id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const full: AlertRule = { ...rule, id };
  rules.push(full);
  await setUserAlertRules(rules);
  return full;
}

/** 删除一条用户规则 */
export async function removeUserAlertRule(id: string): Promise<void> {
  const rules = await getUserAlertRules();
  await setUserAlertRules(rules.filter((r) => r.id !== id));
}

/** 更新一条用户规则（按 id） */
export async function updateUserAlertRule(id: string, patch: Partial<AlertRule>): Promise<void> {
  const rules = await getUserAlertRules();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx >= 0) {
    rules[idx] = { ...rules[idx], ...patch, id };
    await setUserAlertRules(rules);
  }
}

/** 内置默认规则的启用覆盖表（id → enabled）；缺省用 DEFAULT_ALERT_RULES 自身的 enabled */
export async function getDefaultEnabledOverrides(): Promise<Record<string, boolean>> {
  const saved = await storage.getObject<Record<string, boolean>>(DEFAULT_ENABLED_KEY);
  return saved && typeof saved === 'object' ? saved : {};
}

export async function setDefaultRuleEnabled(id: string, enabled: boolean): Promise<void> {
  const cur = await getDefaultEnabledOverrides();
  cur[id] = enabled;
  await storage.setObject(DEFAULT_ENABLED_KEY, cur);
}

/** 合并默认规则（含用户覆盖的 enabled）+ 用户规则（供 poller / UI 使用） */
export async function getAllAlertRules(): Promise<AlertRule[]> {
  const user = await getUserAlertRules();
  const overrides = await getDefaultEnabledOverrides();
  const defaults = DEFAULT_ALERT_RULES.map((r) =>
    r.id in overrides ? { ...r, enabled: overrides[r.id] } : r,
  );
  return [...defaults, ...user];
}

/**
 * 策略信号告警开关：undefined 集合 = 全部开启。
 * 存的是「关闭的策略 id」——默认全开，新增策略无需写盘。
 */
export async function getMutedSignalStrategies(): Promise<Set<string>> {
  const saved = await storage.getObject<string[]>(SIGNAL_ALERT_KEY);
  return new Set(Array.isArray(saved) ? saved : []);
}

export async function setSignalAlertEnabled(strategyId: string, enabled: boolean): Promise<void> {
  const muted = await getMutedSignalStrategies();
  if (enabled) muted.delete(strategyId);
  else muted.add(strategyId);
  await storage.setObject(SIGNAL_ALERT_KEY, [...muted]);
}
