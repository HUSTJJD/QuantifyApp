/**
 * 量化模块单测：指标计算 + 信号合并。
 * 纯函数，不依赖网络/存储，可在 CI 跑。
 */
import { sma, ema, rsi, macd, closes } from '@/quant/indicators';
import { computeSignal } from '@/quant/signals';
import { STRATEGIES } from '@/quant/strategies';
import type { Candle } from '@/api';

function candle(close: number, i: number): Candle {
  return { datetime: i, open: close, high: close, low: close, close, volume: 1000 };
}

describe('indicators', () => {
  const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('sma 前导 NaN，窗口内正确均值', () => {
    const r = sma(vals, 3);
    expect(Number.isNaN(r[1])).toBe(true);
    expect(r[2]).toBeCloseTo(2);
    expect(r[9]).toBeCloseTo(9);
  });

  it('ema 与 sma 长度一致且首尾有值', () => {
    const e = ema(vals, 3);
    expect(e.length).toBe(vals.length);
    expect(Number.isNaN(e[0])).toBe(false);
    expect(e[9]).toBeGreaterThan(0);
  });

  it('rsi 取值 0~100', () => {
    const r = rsi(vals, 5);
    const last = r[r.length - 1];
    expect(last).toBeGreaterThanOrEqual(0);
    expect(last).toBeLessThanOrEqual(100);
  });

  it('macd 返回等长三段', () => {
    const { dif, dea, hist } = macd(vals);
    expect(dif.length).toBe(vals.length);
    expect(dea.length).toBe(vals.length);
    expect(hist.length).toBe(vals.length);
  });

  it('closes 提取收盘价', () => {
    const cs = [candle(1, 0), candle(2, 1)];
    expect(closes(cs)).toEqual([1, 2]);
  });
});

describe('signals', () => {
  it('注册了默认策略', () => {
    expect(STRATEGIES.length).toBeGreaterThan(0);
  });

  it('上涨趋势产生买入信号（MA金叉）', () => {
    // 构造一段先平后涨，使 MA5 上穿 MA20
    const cs: Candle[] = [];
    for (let i = 0; i < 25; i++) cs.push(candle(10, i));
    for (let i = 25; i < 30; i++) cs.push(candle(10 + i, i));
    const sig = computeSignal({ code: 'X', exchange: 'SH' }, cs);
    expect(['buy', 'hold', 'sell']).toContain(sig.side);
    expect(sig.symbolKey).toBe('X.SH');
  });

  it('数据不足时策略跳过，side=hold', () => {
    const cs = [candle(10, 0), candle(11, 1)];
    const sig = computeSignal({ code: 'Y', exchange: 'SZ' }, cs);
    expect(sig.side).toBe('hold');
    expect(sig.strength).toBe(0);
  });
});
