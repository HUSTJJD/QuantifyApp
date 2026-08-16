/**
 * K 线数据有效性校验单测：覆盖各种「脏数据」场景，确保坏数据在数据源边界被识别/剔除，
 * 不会进入图表或指标计算（这正是此前 K 线展示坏掉的根因）。
 */
import { checkCandle, isValidCandle, cleanCandles, toCandle } from '@/api/candleValidity';
import type { Candle } from '@/api/types';

function good(over: Partial<Candle> = {}): Candle {
  return {
    datetime: 1_704_067_200_000,
    open: 10,
    high: 11,
    low: 9.5,
    close: 10.5,
    volume: 1000,
    amount: 10500,
    ...over,
  };
}

describe('checkCandle', () => {
  it('合法 K 线通过', () => {
    expect(checkCandle(good()).valid).toBe(true);
  });

  it('日期字符串可被解析为合法', () => {
    expect(checkCandle(good({ datetime: '2024-01-01' })).valid).toBe(true);
  });

  it('非法时间：NaN / 0 / 负数 / 空 均不通过', () => {
    expect(checkCandle(good({ datetime: NaN as unknown as number })).valid).toBe(false);
    expect(checkCandle(good({ datetime: 0 })).valid).toBe(false);
    expect(checkCandle(good({ datetime: -1 })).valid).toBe(false);
    expect(checkCandle(good({ datetime: '' as unknown as string })).valid).toBe(false);
  });

  it('价格 NaN / 0 均不通过', () => {
    expect(checkCandle(good({ open: Number.NaN })).valid).toBe(false);
    expect(checkCandle(good({ close: 0 })).valid).toBe(false);
    expect(checkCandle(good({ high: 0 })).valid).toBe(false);
  });

  it('价格关系异常均不通过', () => {
    expect(checkCandle(good({ high: 9 })).valid).toBe(false); // high < low/open/close
    expect(checkCandle(good({ low: 12 })).valid).toBe(false); // low > high
    expect(checkCandle(good({ high: 10, low: 10, open: 11, close: 11 })).valid).toBe(false); // high<open
  });

  it('volume 负数 / NaN 不通过', () => {
    expect(checkCandle(good({ volume: -1 })).valid).toBe(false);
    expect(checkCandle(good({ volume: Number.NaN })).valid).toBe(false);
  });

  it('amount 非法（负数/NaN）不通过，缺失则通过', () => {
    expect(checkCandle(good({ amount: -5 })).valid).toBe(false);
    expect(checkCandle(good({ amount: Number.NaN })).valid).toBe(false);
    expect(checkCandle(good({ amount: undefined })).valid).toBe(true);
  });
});

describe('cleanCandles', () => {
  it('过滤掉所有无效行，仅保留合法', () => {
    const list = [
      good(),
      good({ datetime: NaN as unknown as number }),
      good({ high: 5 }),
      good({ volume: -3 }),
    ];
    const out = cleanCandles(list);
    expect(out.length).toBe(1);
    expect(out[0]).toEqual(good());
  });

  it('空 / null / undefined 安全返回空数组', () => {
    expect(cleanCandles([])).toEqual([]);
    expect(cleanCandles(null)).toEqual([]);
    expect(cleanCandles(undefined)).toEqual([]);
  });
});

describe('toCandle（上游脏数据规整）', () => {
  it('把字符串数字行规整为合法 Candle', () => {
    const c = toCandle({ date: '2024-01-01', open: '10', high: '11', low: '9.5', close: '10.5', volume: '1000' });
    expect(c).not.toBeNull();
    expect(isValidCandle(c!)).toBe(true);
    expect(c!.open).toBe(10);
  });

  it('缺失必填字段返回 null', () => {
    expect(toCandle({ open: 10, high: 11, low: 9, close: 10 })).toBeNull(); // 无 datetime
    expect(toCandle({ datetime: '2024-01-01', high: 11, low: 9, close: 10, volume: 1 })).toBeNull(); // 无 open
  });

  it('含 NaN 价格的行被拒绝', () => {
    expect(toCandle({ date: '2024-01-01', open: 10, high: 11, low: 9, close: NaN, volume: 1 })).toBeNull();
  });
});
