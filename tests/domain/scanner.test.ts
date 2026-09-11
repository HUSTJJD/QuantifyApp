/**
 * 全市场扫描引擎单测。
 * 验证：基于本地库遍历、MACD 金叉/均线多头/RSI 区间/涨幅筛选、进度回调。
 */
import { database, resetDatabase } from '@/data/db';
import { MarketMetaStore } from '@/data/db/MarketMetaStore';
import { scanMarket } from '@/quant/scanner';
import { macd } from '@/quant/indicators';
import type { Candle, Symbol } from '@/data/api';

const SYM_A: Symbol = { code: '600519', exchange: 'SH' };
const SYM_B: Symbol = { code: '000001', exchange: 'SZ' };

/** 造一段「末端恰为 MACD 金叉」的日 K 序列：慢跌后连续快涨，截断到金叉发生的那根 */
function macdCrossSeries(): Candle[] {
  const closes: number[] = [];
  const out: Candle[] = [];
  const now = Date.UTC(2024, 0, 2);
  let price = 10;
  // 1) 慢跌 30 根
  for (let i = 0; i < 30; i++) {
    price -= 0.05;
    closes.push(price);
    out.push({ datetime: now + i * 24 * 3600 * 1000, open: price, high: price + 0.05, low: price - 0.05, close: price, volume: 1000 });
  }
  // 2) 连续快涨，直到 MACD 金叉发生（最多 60 根），截断在金叉处
  for (let j = 0; j < 60; j++) {
    price += 0.35;
    closes.push(price);
    out.push({ datetime: now + (30 + j) * 24 * 3600 * 1000, open: price - 0.15, high: price + 0.2, low: price - 0.2, close: price, volume: 1000 });
    const { dif, dea } = macd(closes);
    const i = closes.length - 1;
    if (i > 1 && !Number.isNaN(dif[i - 1]) && !Number.isNaN(dea[i - 1]) && dif[i - 1] <= dea[i - 1] && dif[i] > dea[i]) {
      return out; // 金叉发生，截断
    }
  }
  return out; // 兜底（理论上不会到这）
}

describe('scanMarket 全市场扫描', () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    resetDatabase();
    MarketMetaStore.resetMem();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    AsyncStorage.__reset?.();

    // 预置 2 个标的的本地日 K
    await database().saveCandles(SYM_A, 'day', macdCrossSeries());
    await database().saveCandles(SYM_B, 'day', macdCrossSeries());
    // 标的库
    const store = new MarketMetaStore();
    await store.replaceTickers([
      { symbol: SYM_A, name: '茅台', assetType: 'a-share', market: 'A' as const },
      { symbol: SYM_B, name: '平安', assetType: 'a-share', market: 'A' as const },
    ]);
  });

  it('MACD 金叉筛选命中（非空）', async () => {
    // 先验证构造的序列确实在末端金叉（用 macd 直接算）
    const candles = await database().getCandles(SYM_A, 'day');
    const closes = candles.map((c) => c.close);
    const { dif, dea } = macd(closes);
    const i = closes.length - 1;
    expect(dif[i - 1] <= dea[i - 1] && dif[i] > dea[i]).toBe(true);

    const res = await scanMarket({ macdGoldenCross: true, minBars: 30 });
    expect(res.total).toBe(2);
    expect(res.hits.length).toBeGreaterThanOrEqual(1);
    expect(res.hits[0].reasons).toContain('MACD 金叉');
  });

  it('涨幅硬条件不满足时淘汰', async () => {
    const res = await scanMarket({ minGainPct: 99, minBars: 30 }); // 无标的涨 99%
    expect(res.hits).toHaveLength(0);
  });

  it('RSI 区间硬条件：超出区间淘汰', async () => {
    const res = await scanMarket({ rsiRange: { min: 100, max: 200 }, minBars: 30 }); // RSI 不可能 >100
    expect(res.hits).toHaveLength(0);
  });

  it('进度回调推进 done/hits', async () => {
    const progress: number[] = [];
    const res = await scanMarket({ macdGoldenCross: true, minBars: 30 }, (p) => progress.push(p.done));
    expect(progress).toEqual([1, 2]);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('limit 限制命中数量', async () => {
    const res = await scanMarket({ macdGoldenCross: true, minBars: 30 }, undefined, 1);
    expect(res.hits.length).toBeLessThanOrEqual(1);
  });
});
