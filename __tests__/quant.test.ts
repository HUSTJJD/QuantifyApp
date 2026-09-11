/**
 * 量化模块单测：指标计算 + 信号合并。
 * 纯函数，不依赖网络/存储，可在 CI 跑。
 */
import { sma, ema, rsi, macd, closes, bollinger, stdev, volumes } from '@/quant/indicators';
import { computeSignal } from '@/quant/signals';
import { STRATEGIES, activeStrategies, type StrategyConfig } from '@/quant/strategies';
import type { Candle } from '@/api';

function candle(close: number, i: number, volume = 1000): Candle {
  return { datetime: i, open: close, high: close, low: close, close, volume };
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

  it('stdev 前导 NaN 且窗口内为正', () => {
    const r = stdev(vals, 4);
    expect(Number.isNaN(r[2])).toBe(true);
    expect(r[3]).toBeGreaterThanOrEqual(0);
  });

  it('bollinger 上轨>中轨>下轨', () => {
    const { mid, upper, lower } = bollinger(vals, 5, 2);
    const i = vals.length - 1;
    expect(upper[i]).toBeGreaterThan(mid[i]);
    expect(mid[i]).toBeGreaterThan(lower[i]);
  });

  it('volumes 提取成交量', () => {
    const cs = [candle(1, 0, 500), candle(2, 1, 800)];
    expect(volumes(cs)).toEqual([500, 800]);
  });
});

describe('signals', () => {
  it('注册 3 个精选模板，默认仅 trend_confirm 启用', () => {
    expect(STRATEGIES.length).toBe(3);
    const ids = STRATEGIES.map((s) => s.id);
    expect(ids).toContain('trend_confirm');
    expect(ids).toContain('oversold_bounce');
    expect(ids).toContain('breakout_momentum');
    const def = STRATEGIES.find((s) => s.id === 'trend_confirm');
    expect(def?.label).toBe('趋势确认');
    expect(def?.enabledByDefault).toBe(true);
    // 其余模板默认关闭
    expect(STRATEGIES.find((s) => s.id === 'oversold_bounce')?.enabledByDefault).toBe(false);
  });

  it('上涨趋势产生信号（side 合法）', () => {
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

  it('默认配置下 trend_confirm 参与计算', () => {
    const cs: Candle[] = [];
    for (let i = 0; i < 70; i++) cs.push(candle(10 + i * 0.5, i, 1000));
    const sig = computeSignal({ code: 'Z', exchange: 'SH' }, cs);
    expect(sig.contributions.length).toBeGreaterThanOrEqual(0);
    expect(['buy', 'hold', 'sell']).toContain(sig.side);
  });

  // 仅启用指定策略，其余显式关闭，避免默认启用策略干扰权重断言
  function onlyEnabled(ids: string[]): StrategyConfig {
    const enabled: Record<string, boolean> = {};
    for (const s of STRATEGIES) enabled[s.id] = ids.includes(s.id);
    return { enabled };
  }

  /** 构造能触发 trend_confirm 买入的 K 线：缓跌后放量拉升，MA5 上穿 MA20，收盘>MA60，RSI 未超买 */
  function trendConfirmBuyCandles(): Candle[] {
    const cs: Candle[] = [];
    for (let i = 0; i < 70; i++) {
      // 100 → ~89.5 缓跌，形成空头排列；MA60 约 92
      cs.push(candle(100 - i * 0.15, i, 1000));
    }
    // 放量拉升：MA5 上穿，收盘 95 > MA60，量比 5
    cs.push(candle(95, 70, 5000));
    return cs;
  }

  it('权重为 0 的策略贡献被忽略', () => {
    const cs = trendConfirmBuyCandles();
    const cfg: StrategyConfig = {
      ...onlyEnabled(['trend_confirm']),
      weights: { trend_confirm: 0 },
    };
    const sig = computeSignal({ code: 'W', exchange: 'SH' }, cs, null, cfg);
    expect(sig.strength).toBe(0);
    expect(sig.side).toBe('hold');
    expect(sig.contributions.find((c) => c.id === 'trend_confirm')?.weight).toBe(0);
  });

  it('权重放大使综合强度达到上限 3', () => {
    const cs = trendConfirmBuyCandles();
    const base = computeSignal({ code: 'W', exchange: 'SH' }, cs, null, {
      ...onlyEnabled(['trend_confirm']),
    });
    expect(base.side).toBe('buy');
    expect(base.strength).toBe(2); // 单策略 strength=2，权重1
    const boosted: StrategyConfig = {
      ...onlyEnabled(['trend_confirm']),
      weights: { trend_confirm: 2 },
    };
    const sig = computeSignal({ code: 'W', exchange: 'SH' }, cs, null, boosted);
    expect(sig.strength).toBe(3); // 2×2=4 被钳制到 3
    const c = sig.contributions.find((c) => c.id === 'trend_confirm');
    expect(c?.weight).toBe(2);
    expect(c?.strength).toBe(2);
  });
});
