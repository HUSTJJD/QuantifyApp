import type { Candle } from '@/data/api';
import { toTimeShareSeries } from '../timeShare';

function bar(ts: number, close: number, volume: number, amount?: number): Candle {
  return { datetime: ts, open: close, high: close, low: close, close, volume, amount };
}

describe('toTimeShareSeries', () => {
  it('空输入返回空数组', () => {
    expect(toTimeShareSeries([], 100)).toEqual([]);
  });

  it('计算 price / 均价线 / 涨跌幅', () => {
    const bars = [
      bar(1, 10, 100, 1000),
      bar(2, 11, 100, 1100),
      bar(3, 12, 200, 2400),
    ];
    const s = toTimeShareSeries(bars, 10);
    expect(s).toHaveLength(3);
    expect(s[0].avgPrice).toBeCloseTo(1000 / 100); // 10
    expect(s[1].avgPrice).toBeCloseTo(2100 / 200); // 10.5
    expect(s[2].avgPrice).toBeCloseTo(4500 / 400); // 11.25
    expect(s[2].price).toBe(12);
    expect(s[2].changePct).toBeCloseTo(20); // (12-10)/10*100
    expect(s[2].preClose).toBe(10);
  });

  it('无成交额字段时 avgPrice 为 null，且不抛错', () => {
    const bars = [bar(1, 10, 100), bar(2, 12, 100)];
    const s = toTimeShareSeries(bars, 10);
    expect(s[0].avgPrice).toBeNull();
    expect(s[1].avgPrice).toBeNull();
    expect(s[1].changePct).toBeCloseTo(20);
  });

  it('preClose 为 0 时 changePct 为 0（避免除零 NaN）', () => {
    const s = toTimeShareSeries([bar(1, 5, 10, 50)], 0);
    expect(s[0].changePct).toBe(0);
  });
});
