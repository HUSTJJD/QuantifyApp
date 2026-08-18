/**
 * stock-sdk facade 测试：严格校验「数据有效性」。
 *
 * 关键回归点：toSdkKline 此前错误地读取 Candle.timestamp / Candle.symbol（Candle 根本没有这两个字段），
 * 导致产出的 date/timestamp/code 全为 undefined/''，指标与信号计算拿到的是无效数据却「假通过」。
 * 本测试用真实 Candle 形状，断言：
 *  1) 归一化后 timestamp 与 Candle.datetime 一致且为有限毫秒；
 *  2) date 为合法 YYYY-MM-DD；
 *  3) code 由入参 symbol 正确推导；
 *  4) 含 NaN/非法时间的 K 线被剔除，绝不产出 NaN 日期；
 *  5) computeIndicators / computeSignals 在真实数据上不抛错。
 */
import { computeIndicators, computeSignals, computeIndicatorsByKeys } from '@/lib/stockSdk';
import { isValidCandle } from '@/api/candleValidity';
import type { Candle, Symbol } from '@/api/types';

/** 构造一根符合 Candle 契约的日 K（datetime 为毫秒时间戳） */
function C(over: Partial<Candle>): Candle {
  return {
    datetime: 1_704_067_200_000, // 2024-01-01
    open: 10,
    high: 11,
    low: 9.5,
    close: 10.5,
    volume: 1000,
    amount: 10500,
    ...over,
  };
}

const SYM: Symbol = { code: '600519', exchange: 'SH', name: '贵州茅台' };

describe('stockSdk.toSdkKline 数据有效性（回归）', () => {
  it('归一化后时间/date/code 有效，且 timestamp 等于 Candle.datetime', () => {
    const out = computeIndicators([C({})], { ma: { periods: [5] } }, SYM);
    expect(out.length).toBe(1);
    const k = out[0];
    expect(typeof k.timestamp).toBe('number');
    expect(Number.isFinite(k.timestamp)).toBe(true);
    expect(k.timestamp).toBe(1_704_067_200_000);
    expect(k.date).toBe('2024-01-01');
    expect(k.code).toBe('600519');
    expect(typeof k.open).toBe('number');
    expect(Number.isNaN(k.timestamp)).toBe(false);
  });

  it('含 NaN/非法时间的 K 线被剔除，绝不产出 NaN 日期', () => {
    const bad = computeIndicators(
      [
        C({}), // 正常
        C({ datetime: NaN as unknown as number }), // 非法时间
        C({ close: Number.NaN }), // NaN 价格
      ],
      { ma: { periods: [5] } },
      SYM,
    );
    expect(bad.length).toBe(1); // 仅 1 根有效
    const k = bad[0];
    expect(String(k.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(k.timestamp)).toBe(false);
  });

  it('缺失 symbol 时 code 为空字符串但不崩溃（默认 SH 时区）', () => {
    const out = computeIndicatorsByKeys([C({})], ['ma'], undefined);
    expect(out.length).toBe(1);
    expect(out[0].code).toBe('');
    expect(out[0].tz).toBe('Asia/Shanghai');
  });

  it('computeSignals 在真实 Candle 上不抛错且产出对象', () => {
    const candles: Candle[] = Array.from({ length: 60 }, (_, i) =>
      C({ datetime: 1_704_067_200_000 + i * 86_400_000, close: 10 + Math.sin(i) * 2, high: 12, low: 8 }),
    );
    expect(candles.every(isValidCandle)).toBe(true);
    const sig = computeSignals(candles, undefined, SYM);
    expect(Array.isArray(sig)).toBe(true); // 真实 SDK 的 calcSignals 输出非 1:1 映射，只断言类型与正常产出
    expect(sig.length).toBeGreaterThanOrEqual(0);
  });
});
