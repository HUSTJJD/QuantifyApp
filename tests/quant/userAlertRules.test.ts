import { detectAlerts, type AlertRule, type AlertInput } from '@/features/watchlist/alerts';
import {
  getUserAlertRules,
  addUserAlertRule,
  removeUserAlertRule,
  updateUserAlertRule,
  getAllAlertRules,
} from '@/features/watchlist/userAlertRules';
import { storage } from '@/data/db/storage';
import type { Quote } from '@/data/api';

function makeQuote(code: string, exchange: 'SH' | 'SZ', last: number, prevClose = last): Quote {
  return {
    symbol: { code, exchange },
    last,
    prevClose,
    open: prevClose,
    high: Math.max(last, prevClose),
    low: Math.min(last, prevClose),
    volume: 1000,
    amount: last * 1000,
  };
}

describe('priceAbove / priceBelow 规则', () => {
  const symbol = { code: '600000', exchange: 'SH' as const, name: '测试' };

  it('priceAbove：现价 >= 阈值触发', () => {
    const rule: AlertRule = { id: 'pa', type: 'priceAbove', threshold: 12, symbolKey: '600000.SH' };
    const input: AlertInput = { symbol, quote: makeQuote('600000', 'SH', 12.5) };
    const events = detectAlerts([input], [rule]);
    expect(events).toHaveLength(1);
    expect(events[0].message).toContain('突破');
  });

  it('priceAbove：现价 < 阈值不触发', () => {
    const rule: AlertRule = { id: 'pa', type: 'priceAbove', threshold: 12, symbolKey: '600000.SH' };
    const input: AlertInput = { symbol, quote: makeQuote('600000', 'SH', 11) };
    expect(detectAlerts([input], [rule])).toHaveLength(0);
  });

  it('priceBelow：现价 <= 阈值触发', () => {
    const rule: AlertRule = { id: 'pb', type: 'priceBelow', threshold: 10, symbolKey: '600000.SH' };
    const input: AlertInput = { symbol, quote: makeQuote('600000', 'SH', 9.5) };
    const events = detectAlerts([input], [rule]);
    expect(events).toHaveLength(1);
    expect(events[0].message).toContain('跌破');
  });

  it('priceBelow：现价 > 阈值不触发', () => {
    const rule: AlertRule = { id: 'pb', type: 'priceBelow', threshold: 10, symbolKey: '600000.SH' };
    const input: AlertInput = { symbol, quote: makeQuote('600000', 'SH', 11) };
    expect(detectAlerts([input], [rule])).toHaveLength(0);
  });

  it('symbolKey 不匹配时不触发', () => {
    const rule: AlertRule = { id: 'pa', type: 'priceAbove', threshold: 12, symbolKey: '999999.SH' };
    const input: AlertInput = { symbol, quote: makeQuote('600000', 'SH', 13) };
    expect(detectAlerts([input], [rule])).toHaveLength(0);
  });

  it('disabled 规则不触发', () => {
    const rule: AlertRule = { id: 'pa', type: 'priceAbove', threshold: 12, symbolKey: '600000.SH', enabled: false };
    const input: AlertInput = { symbol, quote: makeQuote('600000', 'SH', 13) };
    expect(detectAlerts([input], [rule])).toHaveLength(0);
  });
});

describe('userAlertRules 存储', () => {
  beforeEach(async () => {
    await storage.remove('user_price_alert_rules_v1');
  });

  it('add + get', async () => {
    const rule = await addUserAlertRule({ type: 'priceAbove', threshold: 20, symbolKey: '600000.SH' });
    expect(rule.id).toMatch(/^user_/);
    const rules = await getUserAlertRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].threshold).toBe(20);
  });

  it('remove', async () => {
    const rule = await addUserAlertRule({ type: 'priceBelow', threshold: 8, symbolKey: '600000.SH' });
    await removeUserAlertRule(rule.id);
    expect(await getUserAlertRules()).toHaveLength(0);
  });

  it('update', async () => {
    const rule = await addUserAlertRule({ type: 'priceAbove', threshold: 20, symbolKey: '600000.SH' });
    await updateUserAlertRule(rule.id, { threshold: 25, enabled: false });
    const rules = await getUserAlertRules();
    expect(rules[0].threshold).toBe(25);
    expect(rules[0].enabled).toBe(false);
  });

  it('getAllAlertRules 合并默认 + 用户', async () => {
    await addUserAlertRule({ type: 'priceAbove', threshold: 20, symbolKey: '600000.SH' });
    const all = await getAllAlertRules();
    // 默认 5 条（含指标类）+ 用户 1 条
    expect(all.length).toBe(6);
    expect(all.some((r) => r.id.startsWith('user_'))).toBe(true);
  });
});
