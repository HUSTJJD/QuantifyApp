import { evaluate } from '../scanner';
import type { Candle } from '@/api';

function mkCandles(closes: number[], volumes: number[]): Candle[] {
  return closes.map((c, i) => ({
    datetime: i,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: volumes[i] ?? 0,
  }));
}

describe('scanner.evaluate —— 放量 / 新高 条件', () => {
  it('无任何条件时返回 null（无可命中原因）', () => {
    const candles = mkCandles([10, 10, 10], [1, 1, 1]);
    expect(evaluate(candles, { minBars: 1 }, 'T')).toBeNull();
  });

  it('volumeSpikeRatio 满足 → 命中并标注放量', () => {
    // 近 5 日均量含当日，ratio ≈ 10/2.8 = 3.57x
    const closes = Array(6).fill(10);
    const vols = [1, 1, 1, 1, 1, 10];
    const hit = evaluate(mkCandles(closes, vols), { minBars: 1, volumeSpikeRatio: 2 }, 'T');
    expect(hit).not.toBeNull();
    expect(hit!.reasons.some((r) => r.includes('放量'))).toBe(true);
    expect(hit!.metrics.volRatio as number).toBeGreaterThan(2);
  });

  it('volumeSpikeRatio 不满足 → 直接淘汰', () => {
    const closes = Array(6).fill(10);
    const vols = [1, 1, 1, 1, 1, 1.2];
    const hit = evaluate(mkCandles(closes, vols), { minBars: 1, volumeSpikeRatio: 2 }, 'T');
    expect(hit).toBeNull();
  });

  it('newHighDays 满足 → 命中并标注 N 日新高', () => {
    const closes = [9, 9, 9, 10]; // 最新 10 创 4 日新高
    const vols = [1, 1, 1, 1];
    const hit = evaluate(mkCandles(closes, vols), { minBars: 1, newHighDays: 4 }, 'T');
    expect(hit).not.toBeNull();
    expect(hit!.reasons.some((r) => r.includes('新高'))).toBe(true);
  });

  it('newHighDays 不满足 → 直接淘汰', () => {
    const closes = [10, 9, 9, 9]; // 最新 9 非新高
    const vols = [1, 1, 1, 1];
    const hit = evaluate(mkCandles(closes, vols), { minBars: 1, newHighDays: 4 }, 'T');
    expect(hit).toBeNull();
  });

  it('放量 + 新高 组合 = 放量突破，两条原因都在', () => {
    const closes = [8, 8, 8, 8, 8, 12]; // 最新 12 创 6 日新高
    const vols = [1, 1, 1, 1, 1, 4]; // 当日 ≈2.5x 均量
    const hit = evaluate(
      mkCandles(closes, vols),
      { minBars: 1, volumeSpikeRatio: 2, newHighDays: 6 },
      'T',
    );
    expect(hit).not.toBeNull();
    expect(hit!.reasons.filter((r) => r.includes('放量') || r.includes('新高')).length).toBe(2);
  });

  it('minGainPct 回归：涨幅达标仍命中（既有条件不被破坏）', () => {
    const closes = [10, 11]; // +10%
    const vols = [1, 1];
    const hit = evaluate(mkCandles(closes, vols), { minBars: 1, minGainPct: 5 }, 'T');
    expect(hit).not.toBeNull();
    expect(hit!.reasons.some((r) => r.includes('涨'))).toBe(true);
  });
});
