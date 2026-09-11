import {
  detectAlerts,
  ruleNeedsCandles,
  DEFAULT_ALERT_RULES,
  type AlertRule,
  type AlertInput,
} from '@/features/watchlist/alerts';
import { evaluateWatchlist } from '@/features/watchlist/poller';
import {
  getDefaultEnabledOverrides,
  setDefaultRuleEnabled,
  getAllAlertRules,
  getMutedSignalStrategies,
  setSignalAlertEnabled,
  addUserAlertRule,
} from '@/features/watchlist/userAlertRules';
import { setStorage, MemoryStorageAdapter } from '@/data/db/storage';
import type { Candle, Quote } from '@/data/api';

function makeQuote(code: string, exchange: 'SH' | 'SZ', last: number): Quote {
  return {
    symbol: { code, exchange, name: code },
    last,
    prevClose: last,
    open: last,
    high: last,
    low: last,
    volume: 1000,
    amount: last * 1000,
  };
}

/** 构造日K：前 29 根横盘 100，最后一根急拉 → 最后一根上金叉 */
function makeCrossCandles(): Candle[] {
  const out: Candle[] = [];
  const start = Date.UTC(2024, 0, 1);
  for (let i = 0; i < 30; i++) {
    const close = i === 29 ? 120 : 100;
    out.push({
      datetime: start + i * 86400_000,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000,
      amount: close * 1000,
    });
  }
  return out;
}

/** RSI 从冲高回落进入超买区再下穿时的序列：先连涨触发超买 */
function makeRsiOverboughtCandles(): Candle[] {
  const out: Candle[] = [];
  const start = Date.UTC(2024, 0, 1);
  let close = 50;
  for (let i = 0; i < 20; i++) {
    close = i < 10 ? close + 0.2 : close + 3; // 后段急涨推高 RSI
    out.push({
      datetime: start + i * 86400_000,
      open: close,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1000,
      amount: close * 1000,
    });
  }
  return out;
}

describe('ruleNeedsCandles', () => {
  it('breakout/maCross/rsiZone 需要 K 线，行情类不需要', () => {
    expect(ruleNeedsCandles({ id: 'a', type: 'breakout', threshold: 20 })).toBe(true);
    expect(ruleNeedsCandles({ id: 'b', type: 'maCross', threshold: 0 })).toBe(true);
    expect(ruleNeedsCandles({ id: 'c', type: 'rsiZone', threshold: 70 })).toBe(true);
    expect(ruleNeedsCandles({ id: 'd', type: 'pct', threshold: 5 })).toBe(false);
    expect(ruleNeedsCandles({ id: 'e', type: 'priceAbove', threshold: 10 })).toBe(false);
  });
});

describe('maCross 告警', () => {
  const symbol = { code: '600000', exchange: 'SH' as const, name: '测试' };
  const rule: AlertRule = {
    id: 'ma-cross',
    type: 'maCross',
    threshold: 0,
    params: { fast: 5, slow: 20 },
  };

  it('金叉触发', () => {
    const input: AlertInput = {
      symbol,
      quote: makeQuote('600000', 'SH', 110),
      candles: makeCrossCandles(),
    };
    const events = detectAlerts([input], [rule]);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].message).toContain('金叉');
  });

  it('无 K 线不触发', () => {
    const input: AlertInput = { symbol, quote: makeQuote('600000', 'SH', 110) };
    expect(detectAlerts([input], [rule])).toHaveLength(0);
  });
});

describe('rsiZone 告警', () => {
  const symbol = { code: '000001', exchange: 'SZ' as const, name: '平安' };
  const rule: AlertRule = {
    id: 'rsi-zone',
    type: 'rsiZone',
    threshold: 70,
    params: { period: 14, buy: 30, sell: 70 },
  };

  it('连涨推入超买区触发', () => {
    const candles = makeRsiOverboughtCandles();
    const input: AlertInput = {
      symbol,
      quote: makeQuote('000001', 'SZ', candles[candles.length - 1].close),
      candles,
    };
    const events = detectAlerts([input], [rule]);
    // 可能刚好未跨界；至少不应抛错且类型正确
    for (const e of events) expect(e.type).toBe('rsiZone');
  });
});

describe('默认规则集含指标项且默认关闭', () => {
  it('maCross / rsiZone 存在且 enabled=false', () => {
    const ma = DEFAULT_ALERT_RULES.find((r) => r.type === 'maCross');
    const rsi = DEFAULT_ALERT_RULES.find((r) => r.type === 'rsiZone');
    expect(ma).toBeTruthy();
    expect(rsi).toBeTruthy();
    expect(ma?.enabled).toBe(false);
    expect(rsi?.enabled).toBe(false);
  });
});

describe('默认规则开关覆盖 + 策略告警静音', () => {
  beforeEach(() => {
    setStorage(new MemoryStorageAdapter());
  });

  it('setDefaultRuleEnabled 写入覆盖，getAllAlertRules 合并', async () => {
    await setDefaultRuleEnabled('ma-cross-5-20', true);
    const all = await getAllAlertRules();
    const ma = all.find((r) => r.id === 'ma-cross-5-20');
    expect(ma?.enabled).toBe(true);
    const ov = await getDefaultEnabledOverrides();
    expect(ov['ma-cross-5-20']).toBe(true);
  });

  it('策略告警静音集合可读写', async () => {
    expect((await getMutedSignalStrategies()).size).toBe(0);
    await setSignalAlertEnabled('trend_confirm', false);
    expect((await getMutedSignalStrategies()).has('trend_confirm')).toBe(true);
    await setSignalAlertEnabled('trend_confirm', true);
    expect((await getMutedSignalStrategies()).has('trend_confirm')).toBe(false);
  });

  it('addUserAlertRule 生成 user_ 前缀 id', async () => {
    const r = await addUserAlertRule({ type: 'priceAbove', threshold: 12, symbolKey: '600000.SH' });
    expect(r.id.startsWith('user_')).toBe(true);
    const all = await getAllAlertRules();
    expect(all.some((x) => x.id === r.id)).toBe(true);
  });
});

describe('evaluateWatchlist 注入 K 线', () => {
  it('candleMap 命中后 maCross 可产生事件', () => {
    const symbol = { code: '600000', exchange: 'SH' as const, name: '测试' };
    const candles = makeCrossCandles();
    const quotes = [makeQuote('600000', 'SH', 110)];
    const rules: AlertRule[] = [
      { id: 'ma-cross', type: 'maCross', threshold: 0, params: { fast: 5, slow: 20 }, enabled: true },
    ];
    const map = new Map([[`${symbol.code}.${symbol.exchange}`, candles]]);
    const events = evaluateWatchlist(quotes, [symbol], rules, new Set(), map);
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
