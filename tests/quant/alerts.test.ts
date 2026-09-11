import { detectAlerts, DEFAULT_ALERT_RULES, type AlertInput } from '@/features/watchlist/alerts';
import type { Symbol, Quote, Candle } from '@/data/api';

const SYM: Symbol = { code: '600519', exchange: 'SH', name: '茅台' };

function q(partial: Partial<Quote>): Quote {
  return {
    symbol: SYM,
    last: 100,
    prevClose: 100,
    open: 100,
    high: 100,
    low: 100,
    volume: 0,
    amount: 0,
    updatedAt: 0,
    ...partial,
  };
}

function candles(highs: number[]): Candle[] {
  return highs.map((h, i) => ({
    datetime: i,
    open: h - 1,
    high: h,
    low: h - 2,
    close: h,
    volume: 1000,
    amount: h * 1000,
  }));
}

describe('alerts 异动检测', () => {
  it('pct 规则：涨幅超阈值触发', () => {
    const inputs: AlertInput[] = [{ symbol: SYM, quote: q({ last: 106, prevClose: 100 }) }];
    const ev = detectAlerts(inputs, [{ id: 'p', type: 'pct', threshold: 5 }]);
    expect(ev).toHaveLength(1);
    expect(ev[0].type).toBe('pct');
    expect(ev[0].value).toBeCloseTo(6);
  });

  it('pct 规则：未达阈值不触发', () => {
    const inputs: AlertInput[] = [{ symbol: SYM, quote: q({ last: 103, prevClose: 100 }) }];
    const ev = detectAlerts(inputs, [{ id: 'p', type: 'pct', threshold: 5 }]);
    expect(ev).toHaveLength(0);
  });

  it('pct 规则：下跌也触发（绝对值）', () => {
    const inputs: AlertInput[] = [{ symbol: SYM, quote: q({ last: 94, prevClose: 100 }) }];
    const ev = detectAlerts(inputs, [{ id: 'p', type: 'pct', threshold: 5 }]);
    expect(ev).toHaveLength(1);
    expect(ev[0].value).toBeCloseTo(-6);
  });

  it('volumeSpike 规则：成交量超阈值触发', () => {
    const inputs: AlertInput[] = [{ symbol: SYM, quote: q({ volume: 600000 }) }];
    const ev = detectAlerts(inputs, [{ id: 'v', type: 'volumeSpike', threshold: 500000 }]);
    expect(ev).toHaveLength(1);
    expect(ev[0].value).toBe(600000);
  });

  it('breakout 规则：创 N 根新高触发', () => {
    const inputs: AlertInput[] = [{ symbol: SYM, quote: q({}), candles: candles([10, 11, 12, 13, 20]) }];
    const ev = detectAlerts(inputs, [{ id: 'b', type: 'breakout', threshold: 4 }]);
    expect(ev).toHaveLength(1);
    expect(ev[0].type).toBe('breakout');
  });

  it('breakout 规则：无新高不触发', () => {
    const inputs: AlertInput[] = [{ symbol: SYM, quote: q({}), candles: candles([20, 11, 12, 13, 15]) }];
    const ev = detectAlerts(inputs, [{ id: 'b', type: 'breakout', threshold: 4 }]);
    expect(ev).toHaveLength(0);
  });

  it('disabled 规则不触发', () => {
    const inputs: AlertInput[] = [{ symbol: SYM, quote: q({ last: 110, prevClose: 100 }) }];
    const ev = detectAlerts(inputs, [{ id: 'p', type: 'pct', threshold: 5, enabled: false }]);
    expect(ev).toHaveLength(0);
  });

  it('默认规则集：多标的多规则聚合', () => {
    const inputs: AlertInput[] = [
      { symbol: SYM, quote: q({ last: 108, prevClose: 100, volume: 600000 }) },
      { symbol: { code: '000001', exchange: 'SZ' }, quote: q({ last: 100, prevClose: 100 }) },
    ];
    const ev = detectAlerts(inputs, DEFAULT_ALERT_RULES);
    // 第一只触发 pct(8%) 与 volumeSpike；第二只无
    expect(ev.length).toBeGreaterThanOrEqual(2);
    expect(ev.some((e) => e.type === 'pct')).toBe(true);
    expect(ev.some((e) => e.type === 'volumeSpike')).toBe(true);
  });
});
