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
  it('注册了 6 个策略（含新增布林带/量价背离）', () => {
    expect(STRATEGIES.length).toBe(6);
    const ids = STRATEGIES.map((s) => s.id);
    expect(ids).toContain('bollinger_breakout');
    expect(ids).toContain('volume_price_divergence');
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

  it('布林带突破策略：收盘价突破上轨产生买入', () => {
    // 构造平稳后最后一笔放量突破
    const cs: Candle[] = [];
    for (let i = 0; i < 25; i++) cs.push(candle(100, i));
    cs[cs.length - 1] = candle(140, 25); // 远高于上轨
    const cfg: StrategyConfig = { enabled: { bollinger_breakout: true } };
    const sig = computeSignal({ code: 'B', exchange: 'SZ' }, cs, null, cfg);
    expect(sig.side).toBe('buy');
    expect(sig.reasons.join()).toContain('布林');
  });

  it('量价背离策略：价升量缩产生卖出', () => {
    const cs: Candle[] = [];
    for (let i = 0; i < 22; i++) cs.push(candle(100 + i, i, 2000)); // 量稳定
    cs[cs.length - 1] = candle(123, 22, 200); // 价新高但量骤减
    const cfg: StrategyConfig = { enabled: { volume_price_divergence: true } };
    const sig = computeSignal({ code: 'V', exchange: 'SZ' }, cs, null, cfg);
    expect(sig.side).toBe('sell');
    expect(sig.reasons.join()).toContain('背离');
  });

  it('MA 参数可配置：自定义快/慢周期生效', () => {
    // 仅启用 ma_cross，快3/慢10。先平稳让快慢线重合，最后一根暴涨使 MA3 上穿 MA10。
    const cs: Candle[] = [];
    for (let i = 0; i < 14; i++) cs.push(candle(10, i));
    cs.push(candle(50, 14)); // 最后一根猛拉，fast 立即抬升越过慢线
    const cfg: StrategyConfig = {
      enabled: { ma_cross: true },
      params: { ma_cross: { fast: 3, slow: 10 } },
    };
    const sig = computeSignal({ code: 'P', exchange: 'SH' }, cs, null, cfg);
    expect(sig.side).toBe('buy');
    expect(sig.reasons.join()).toContain('MA3');
  });

  // 仅启用指定策略，其余显式关闭，避免默认启用策略干扰权重断言
  function onlyEnabled(ids: string[]): StrategyConfig {
    const enabled: Record<string, boolean> = {};
    for (const s of STRATEGIES) enabled[s.id] = ids.includes(s.id);
    return { enabled };
  }

  it('多策略组合：权重为 0 的策略贡献被忽略', () => {
    const cs: Candle[] = [];
    for (let i = 0; i < 14; i++) cs.push(candle(10, i));
    cs.push(candle(50, 14)); // 最后一根猛拉使 MA3 上穿 MA10
    const cfg: StrategyConfig = {
      ...onlyEnabled(['ma_cross']),
      params: { ma_cross: { fast: 3, slow: 10 } },
      weights: { ma_cross: 0 },
    };
    const sig = computeSignal({ code: 'W', exchange: 'SH' }, cs, null, cfg);
    expect(sig.strength).toBe(0);
    expect(sig.side).toBe('hold');
    expect(sig.contributions.find((c) => c.id === 'ma_cross')?.weight).toBe(0);
  });

  it('多策略组合：权重放大使综合强度达到上限 3', () => {
    const cs: Candle[] = [];
    for (let i = 0; i < 14; i++) cs.push(candle(10, i));
    cs.push(candle(50, 14)); // 最后一根猛拉使 MA3 上穿 MA10
    const base = computeSignal({ code: 'W', exchange: 'SH' }, cs, null, {
      ...onlyEnabled(['ma_cross']),
      params: { ma_cross: { fast: 3, slow: 10 } },
    });
    expect(base.strength).toBe(2); // 单策略 strength=2，权重1
    const boosted: StrategyConfig = {
      ...onlyEnabled(['ma_cross']),
      params: { ma_cross: { fast: 3, slow: 10 } },
      weights: { ma_cross: 2 },
    };
    const sig = computeSignal({ code: 'W', exchange: 'SH' }, cs, null, boosted);
    expect(sig.strength).toBe(3); // 2×2=4 被钳制到 3
    const c = sig.contributions.find((c) => c.id === 'ma_cross');
    expect(c?.weight).toBe(2);
    expect(c?.strength).toBe(2);
  });
});
