/**
 * K 线形态 + 基本面筛选单测（对照 InStock 移植）。
 */
import type { Candle } from '@/data/api';
import { detectPatterns, patternNetScore } from '@/quant/patterns';
import { checkFundamental, extractRoe } from '@/quant/fundamentals';
import { checkParkingApron, checkLowBacktraceIncrease } from '@/quant/core/myhhub';

function candle(o: number, h: number, l: number, c: number, v = 1e6): Candle {
  return { datetime: Date.now(), open: o, high: h, low: l, close: c, volume: v, amount: o * v };
}

describe('patterns', () => {
  it('看涨吞没', () => {
    const data = [candle(10, 10.2, 9.8, 9.9), candle(9.8, 10.5, 9.7, 10.4)];
    const hits = detectPatterns(data);
    expect(hits.some((h) => h.id === 'bullish_engulfing' && h.signal > 0)).toBe(true);
  });

  it('晨星', () => {
    const data = [
      candle(10, 10.1, 9.5, 9.6),
      candle(9.5, 9.6, 9.4, 9.5),
      candle(9.6, 10.2, 9.55, 10.1),
    ];
    const hits = detectPatterns(data);
    expect(hits.some((h) => h.id === 'morning_star' && h.signal > 0)).toBe(true);
  });

  it('空数据安全', () => {
    expect(detectPatterns([])).toEqual([]);
    expect(patternNetScore([])).toBe(0);
  });
});

describe('fundamentals', () => {
  it('PE/PB/ROE 合格', () => {
    const r = checkFundamental(
      { valuation: { symbol: { code: '600519', exchange: 'SH' }, peTtm: 15, peMrq: 15, pbMrq: 5, psTtm: 3, pcfTtm: 10 }, indicators: [{ category: 'profitability', indexId: 'roe', value: '18' }] },
    );
    expect(r.pass).toBe(true);
  });

  it('ROE 不足失败', () => {
    const r = checkFundamental(
      { valuation: { symbol: { code: 'x', exchange: 'SH' }, peTtm: 10, peMrq: 10, pbMrq: 1, psTtm: 1, pcfTtm: 1 }, indicators: [{ category: 'profitability', indexId: 'roe', value: '5' }] },
    );
    expect(r.pass).toBe(false);
    expect(r.roe).toBe(5);
  });

  it('extractRoe 小数自动放大', () => {
    expect(extractRoe([{ category: 'profitability', indexId: 'roe', value: '0.18' }])).toBeCloseTo(18);
  });
});

describe('parking / backtrace', () => {
  it('无大幅回撤：不足涨幅失败', () => {
    const data = Array.from({ length: 60 }, (_, i) => candle(100, 101, 99, 100 + i * 0.1));
    expect(checkLowBacktraceIncrease(data)).toBe(false);
  });

  it('停机坪：数据不足返回 false', () => {
    expect(checkParkingApron([candle(10, 10, 10, 10)])).toBe(false);
  });
});
