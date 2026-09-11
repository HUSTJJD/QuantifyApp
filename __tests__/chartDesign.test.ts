/**
 * chart 层测试：市场时段 / 指标元信息 / Provider 约定。
 */
import { isMarketTradingTime } from '@/chart/marketSessions';
import {
  getIndicatorGroup,
  toNativeMainCode,
  toNativeSubCode,
  getMAPeriods,
  MAIN_INDICATOR_METAS,
  SUB_INDICATOR_METAS,
} from '@/chart/indicatorMeta';
import { toKlinePeriod, isTimelinePeriod, chartMarketOf } from '@/chart';
import type { Symbol } from '@/data/api';

describe('marketSessions', () => {
  it('A 股盘中为 true，周末为 false', () => {
    // 2026-09-14 是周一 10:00 北京时间 ≈ UTC 02:00
    const monOpen = new Date(Date.UTC(2026, 8, 14, 2, 0, 0));
    expect(isMarketTradingTime('A', monOpen)).toBe(true);
    const sat = new Date(Date.UTC(2026, 8, 12, 2, 0, 0));
    expect(isMarketTradingTime('A', sat)).toBe(false);
  });

  it('A 股午休为 false', () => {
    // 12:00 北京 = UTC 04:00
    const lunch = new Date(Date.UTC(2026, 8, 14, 4, 0, 0));
    expect(isMarketTradingTime('A', lunch)).toBe(false);
  });
});

describe('indicatorMeta', () => {
  it('主副图分组正确', () => {
    expect(getIndicatorGroup('ma')).toBe('main');
    expect(getIndicatorGroup('boll')).toBe('main');
    expect(getIndicatorGroup('macd')).toBe('sub');
    expect(getIndicatorGroup('volume')).toBe('sub');
    expect(MAIN_INDICATOR_METAS.length).toBeGreaterThan(0);
    expect(SUB_INDICATOR_METAS.length).toBeGreaterThan(0);
  });

  it('native 编码映射', () => {
    expect(toNativeMainCode('ma')).toBe(1);
    expect(toNativeMainCode('boll')).toBe(2);
    expect(toNativeMainCode('none')).toBe(0);
    expect(toNativeSubCode('macd')).toBe(3);
    expect(toNativeSubCode('rsi')).toBe(5);
  });

  it('默认 MA 周期', () => {
    expect(getMAPeriods()).toEqual([5, 10, 20, 30, 60]);
    expect(getMAPeriods([20, 5, 5])).toEqual([5, 20]);
  });
});

describe('chart types helpers', () => {
  it('周期映射', () => {
    expect(toKlinePeriod('day')).toBe('day');
    expect(toKlinePeriod('timeline')).toBe('1m');
    expect(toKlinePeriod('60m')).toBe('60m');
    expect(isTimelinePeriod('timeline')).toBe(true);
    expect(isTimelinePeriod('day')).toBe(false);
  });

  it('市场推断', () => {
    expect(chartMarketOf({ code: '600519', exchange: 'SH' } as Symbol)).toBe('A');
    expect(chartMarketOf({ code: '00700', exchange: 'HK' } as Symbol)).toBe('HK');
    expect(chartMarketOf({ code: 'AAPL', exchange: 'US' } as Symbol)).toBe('US');
  });
});
