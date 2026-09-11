import {
  prepareCandles,
  loadBacktestCandles,
  loadBacktestSeries,
} from '@/quant/backtestData';
import type { Candle, Symbol } from '@/data/api';

const SYM: Symbol = { code: '600519', exchange: 'SH', name: '茅台' };

function candle(date: string, close = 100): Candle {
  return {
    datetime: date,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  };
}

describe('prepareCandles', () => {
  it('升序排序', () => {
    const raw = [candle('2024-01-03'), candle('2024-01-01'), candle('2024-01-02')];
    const { candles, ok } = prepareCandles(raw, { minBars: 1 });
    expect(ok).toBe(true);
    expect(candles.map((c) => c.datetime)).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
  });

  it('按时间毫秒去重', () => {
    const raw = [candle('2024-01-01'), candle('2024-01-01', 101), candle('2024-01-02')];
    const { candles } = prepareCandles(raw);
    expect(candles).toHaveLength(2);
  });

  it('区间裁剪 startMs/endMs', () => {
    const raw = [candle('2024-01-01'), candle('2024-01-02'), candle('2024-01-03'), candle('2024-01-04')];
    const t = (d: string) => new Date(d).getTime();
    const { candles } = prepareCandles(raw, { startMs: t('2024-01-02'), endMs: t('2024-01-03') });
    expect(candles.map((c) => c.datetime)).toEqual(['2024-01-02', '2024-01-03']);
  });

  it('不足 minBars 返回 ok=false + reason', () => {
    const raw = [candle('2024-01-01'), candle('2024-01-02')];
    const r = prepareCandles(raw, { minBars: 30 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('不足');
  });

  it('空数组返回 ok=false', () => {
    expect(prepareCandles([]).ok).toBe(false);
  });
});

describe('loadBacktestCandles', () => {
  it('向前翻页补齐到 startMs', async () => {
    const page1 = [candle('2024-01-03'), candle('2024-01-04'), candle('2024-01-05')];
    const page2 = [candle('2024-01-01'), candle('2024-01-02'), candle('2024-01-03')];
    const fetchKline = jest.fn(async (p: { endMs?: number }) => {
      return p.endMs === undefined ? page1 : page2;
    });
    const startMs = new Date('2024-01-01').getTime();
    const candles = await loadBacktestCandles(SYM, { count: 3, maxPages: 5, startMs, fetchKline });
    expect(fetchKline).toHaveBeenCalledTimes(2); // 首拉 + 向前翻一页
    expect(candles.map((c) => c.datetime)).toEqual([
      '2024-01-01',
      '2024-01-02',
      '2024-01-03',
      '2024-01-04',
      '2024-01-05',
    ]);
  });

  it('无数据直接返回空', async () => {
    const candles = await loadBacktestCandles(SYM, { fetchKline: async () => [] });
    expect(candles).toEqual([]);
  });

  it('默认周期 day、count 250', async () => {
    const fetchKline = jest.fn(async () => [candle('2024-01-01')]);
    await loadBacktestCandles(SYM, { fetchKline });
    expect((fetchKline.mock.calls[0] as unknown[])[0]).toMatchObject({ period: 'day', count: 250 });
  });

  it('强制不复权：即使调用方传 adjust=forward 也请求 none', async () => {
    const fetchKline = jest.fn(async () => [candle('2024-01-01')]);
    await loadBacktestCandles(SYM, { fetchKline, adjust: 'forward' });
    expect((fetchKline.mock.calls[0] as unknown[])[0]).toMatchObject({ adjust: 'none' });
  });
});

describe('loadBacktestSeries（可信复权链路）', () => {
  const exDate = new Date('2024-01-03T00:00:00+08:00').getTime();
  const rawCs: Candle[] = [
    candle('2024-01-02', 10),
    candle('2024-01-03', 11),
    candle('2024-01-04', 12),
  ];

  it('本地K线 + 本地因子 → 前复权合成', async () => {
    const series = await loadBacktestSeries(SYM, {
      adjustMode: 'forward',
      loadLocal: async () => rawCs,
      loadFactors: async () => [{ exDateMs: exDate, perShareBonus: 0.1 }],
    });
    expect(series.source).toBe('local');
    expect(series.usedLocalFactors).toBe(true);
    expect(series.factorCount).toBe(1);
    // 1/2 早于除权日 → 系数 1.1
    expect(series.candles[0].close).toBeCloseTo(11, 5);
    // 除权日当天保持原价
    expect(series.candles[1].close).toBe(11);
    expect(series.raw[0].close).toBe(10);
    expect(series.note).toContain('前复权');
    expect(series.note).toContain('本地因子');
  });

  it('无因子时原样返回不复权', async () => {
    const series = await loadBacktestSeries(SYM, {
      adjustMode: 'forward',
      loadLocal: async () => rawCs,
      loadFactors: async () => [],
    });
    expect(series.usedLocalFactors).toBe(false);
    expect(series.candles[0].close).toBe(10);
    expect(series.note).toContain('无本地复权因子');
  });

  it('adjustMode=none 不合成', async () => {
    const series = await loadBacktestSeries(SYM, {
      adjustMode: 'none',
      loadLocal: async () => rawCs,
      loadFactors: async () => [{ exDateMs: exDate, perShareBonus: 0.1 }],
    });
    expect(series.candles[0].close).toBe(10);
    expect(series.usedLocalFactors).toBe(false);
  });

  it('本地无K线回退网络（仍不复权）', async () => {
    const fetchKline = jest.fn(async () => rawCs);
    const series = await loadBacktestSeries(SYM, {
      count: 10,
      fetchKline,
      loadLocal: async () => null,
      loadFactors: async () => [{ exDateMs: exDate, perShareBonus: 0.1 }],
    });
    expect(series.source).toBe('network');
    expect((fetchKline.mock.calls[0] as unknown[])[0]).toMatchObject({ adjust: 'none' });
    expect(series.usedLocalFactors).toBe(true);
  });

  it('loadFactors 抛错视为 0 因子', async () => {
    const series = await loadBacktestSeries(SYM, {
      loadLocal: async () => rawCs,
      loadFactors: async () => {
        throw new Error('index no factors');
      },
    });
    expect(series.factorCount).toBe(0);
    expect(series.candles[0].close).toBe(10);
  });
});
