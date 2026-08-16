import {
  prepareCandles,
  loadBacktestCandles,
} from '@/quant/backtestData';
import type { Candle, Symbol } from '@/api';

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
});
