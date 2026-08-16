/**
 * src/lib/stockSdk 工具层测试
 *
 * 覆盖目标：纯计算能力 facade（指标 / 信号 / 符号解析 / 选股 / 回测）的再导出与
 * 业务封装是否正确：
 *  - 指标原语再导出（calcMA / calcMACD / ... / addIndicators）
 *  - computeIndicators：业务 Candle 归一化为 SDK Kline 后追加指标
 *  - computeSignals：在 K 线上识别交易信号
 *  - parseSymbol：符号容错解析，返回 SymbolRef
 *  - screen / backtest：选股与单标的多头回测链路
 * 注：subpath 模块（stock-sdk/indicators 等）为真实实现，仅做行为断言，不做网络 mock。
 */
import {
  calcMA,
  computeIndicators,
  computeIndicatorsByKeys,
  computeSignals,
  parseSymbol,
  screen,
  backtest,
  addIndicators,
  calcMACD,
} from '@/lib/stockSdk';
import type { Candle } from '@/api/types';

const C = (o: number, h: number, l: number, c: number, v = 100, t = 1700000000000): Candle => ({
  symbol: { code: '600519', exchange: 'SH' } as any,
  timestamp: t,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: v,
  amount: v * c,
});

describe('符号解析 parseSymbol', () => {
  it('normalizeSymbol 容错多种写法', () => {
    expect(parseSymbol('sh600519').market).toBeDefined();
    expect(parseSymbol('600519').code).toBe('600519');
    expect(parseSymbol('00700').code).toBe('00700');
    expect(parseSymbol('AAPL').code).toBe('AAPL');
  });
  it('返回对象含 market / code 字段', () => {
    const ref = parseSymbol('600519');
    expect(ref).toHaveProperty('market');
    expect(ref).toHaveProperty('code');
  });
});

describe('指标 computeIndicators', () => {
  const candles = [
    C(10, 11, 9, 10),
    C(10, 12, 9, 11),
    C(11, 13, 10, 12),
    C(12, 14, 11, 13),
    C(13, 15, 12, 14),
  ];
  it('透传 calcMA / calcMACD 原语', () => {
    expect(typeof calcMA).toBe('function');
    expect(typeof calcMACD).toBe('function');
    expect(typeof addIndicators).toBe('function');
  });
  it('追加 MA 指标并返回同长度数组', () => {
    const out = computeIndicatorsByKeys(candles, ['ma']);
    expect(out).toHaveLength(candles.length);
    // 末根 ma5 = 收盘价均值（MA 默认含 period 5）
    const last = out[out.length - 1];
    expect(last).toHaveProperty('ma');
    expect(last.ma.ma5).toBeCloseTo((10 + 11 + 12 + 13 + 14) / 5, 5);
  });
  it('追加 MACD 指标', () => {
    const out = computeIndicatorsByKeys(candles, ['macd']);
    const keys = Object.keys(out[out.length - 1]);
    // 除基础字段外应至少新增一个指标字段（macd 结果对象）
    const added = keys.filter((k) => !['date', 'timestamp', 'tz', 'code', 'open', 'high', 'low', 'close', 'volume', 'amount'].includes(k));
    expect(added.length).toBeGreaterThan(0);
    expect(out[out.length - 1].macd).toHaveProperty('dif');
  });
  it('归一化保留 close / high / low 字段', () => {
    const out = computeIndicatorsByKeys(candles, ['ma']);
    expect(out[0].close).toBe(10);
    expect(out[0].high).toBe(11);
  });
  it('computeIndicators 接受 IndicatorOptions 对象（小写 key）', () => {
    const out = computeIndicators(candles, { ma: { periods: [5] }, macd: {} });
    expect(out[out.length - 1]).toHaveProperty('ma');
    expect(out[out.length - 1]).toHaveProperty('macd');
  });
});

describe('信号 computeSignals', () => {
  it('返回数组且可包含金叉/死叉事件', () => {
    const candles = Array.from({ length: 30 }, (_, i) => C(i, i + 1, i - 1, i));
    const out = computeSignals(candles);
    expect(Array.isArray(out)).toBe(true);
  });
});

describe('选股 screen', () => {
  it('链式 where/sortBy/top 过滤排序', () => {
    const items = [
      { code: 'A', pe: 15, changePercent: 4, amount: 100 },
      { code: 'B', pe: 8, changePercent: 2, amount: 300 },
      { code: 'C', pe: 25, changePercent: 5, amount: 200 },
    ];
    const picks = screen(items)
      .where((q) => q.pe != null && q.pe < 20)
      .where((q) => q.changePercent > 3)
      .sortBy((q) => q.amount, 'desc')
      .top(10);
    // pe<20 且 changePercent>3 仅命中 A（B 的 changePercent=2 被过滤）
    expect(picks.map((p) => p.code)).toEqual(['A']);
  });
});

describe('回测 backtest', () => {
  it('在金叉买入、死叉卖出后给出收益报告', () => {
    const klines = Array.from({ length: 40 }, (_, i) => C(i, i + 1, i - 1, i));
    const report = backtest({
      klines,
      strategy: (bar: any, _i, series) => {
        const closes = series.slice(0, _i + 1).map((b: any) => b.close);
        if (closes.length < 5) return 'hold';
        const ma3 = closes.slice(-3).reduce((a: number, b: number) => a + b, 0) / 3;
        const ma5 = closes.slice(-5).reduce((a: number, b: number) => a + b, 0) / 5;
        if (ma3 > ma5) return 'buy';
        if (ma3 < ma5) return 'sell';
        return 'hold';
      },
    });
    expect(report).toHaveProperty('finalEquity');
    expect(report).toHaveProperty('totalReturn');
    expect(report).toHaveProperty('trades');
    expect(typeof report.totalReturn).toBe('number');
  });
});
