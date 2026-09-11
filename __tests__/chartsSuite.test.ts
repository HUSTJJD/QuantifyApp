/**
 * charts 层测试：完整指标套件 / 格式化 / 引擎探测（Jest 下应全部降级）。
 */
import {
  calcSMA,
  calcEMA,
  calcMACD,
  calcBOLL,
  calcKDJ,
  calcRSI,
  calcBIAS,
  calcATR,
  calcSAR,
  calcKC,
  toOHLCV,
} from '@/charts/indicators';
import {
  formatPrice,
  formatPercent,
  formatVolume,
  formatChange,
  formatDate,
  smartNumber,
} from '@/charts/formatters';
import {
  isSkiaAvailable,
  isGraphAvailable,
  isKlineChartAvailable,
  isEchartsSkiaAvailable,
  isWorkletsHealthy,
  probeChartEngines,
} from '@/charts/availability';

const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const ohlcv = toOHLCV(
  closes.map((c, i) => ({
    open: c - 0.5,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 1000 + i * 10,
  })),
);

describe('charts/indicators', () => {
  it('SMA 前置不足周期为 null', () => {
    const ma = calcSMA(closes, 5);
    expect(ma).toHaveLength(closes.length);
    expect(ma[3]).toBeNull();
    expect(ma[4]).toBeCloseTo(12, 6);
  });

  it('EMA 从第一个有效值启动', () => {
    const ema = calcEMA(closes, 3);
    expect(ema[0]).toBe(10);
    expect(ema[1]).toBeCloseTo(10.5, 6);
  });

  it('MACD 输出 dif/dea/macd', () => {
    const macd = calcMACD(closes);
    expect(macd).toHaveLength(closes.length);
    const last = macd[macd.length - 1]!;
    expect(last.dif).not.toBeNull();
    expect(last.macd).not.toBeNull();
  });

  it('BOLL 三轨', () => {
    const boll = calcBOLL(closes, { period: 5 });
    const last = boll[boll.length - 1]!;
    expect(last.mid).not.toBeNull();
    expect(last.upper!).toBeGreaterThan(last.mid!);
    expect(last.lower!).toBeLessThan(last.mid!);
  });

  it('KDJ / RSI / BIAS / ATR / SAR / KC 可计算', () => {
    expect(calcKDJ(ohlcv).at(-1)?.k).not.toBeNull();
    expect(calcRSI(closes).at(-1)?.rsi6).not.toBeNull();
    expect(calcBIAS(closes).at(-1)?.bias6).not.toBeNull();
    expect(calcATR(ohlcv, { period: 5 }).at(-1)?.atr).not.toBeNull();
    expect(calcSAR(ohlcv).at(-1)?.sar).not.toBeNull();
    expect(calcKC(ohlcv, { emaPeriod: 5, atrPeriod: 5 }).at(-1)?.mid).not.toBeNull();
  });
});

describe('charts/formatters', () => {
  it('价格 / 百分比 / 涨跌额', () => {
    expect(formatPrice(1234.5)).toBe('1,234.50');
    expect(formatPercent(3.21)).toBe('+3.21%');
    expect(formatPercent(-1)).toBe('-1.00%');
    expect(formatChange(0.5)).toBe('+0.50');
  });

  it('成交量万/亿', () => {
    expect(formatVolume(999)).toBe('999');
    expect(formatVolume(12345)).toBe('1.23万');
    expect(formatVolume(2e8)).toBe('2亿');
  });

  it('日期本地解析不跨日', () => {
    expect(formatDate('2026-09-14', 'YYYY-MM-DD')).toBe('2026-09-14');
    expect(formatDate('2026-09-14 09:30', 'MM-DD HH:mm')).toBe('09-14 09:30');
  });

  it('smartNumber 去掉尾零', () => {
    expect(smartNumber(2, 2)).toBe('2');
    expect(smartNumber(1.5, 2)).toBe('1.5');
  });
});

describe('charts/availability (Jest 环境全部 false)', () => {
  it('测试环境不加载原生引擎', async () => {
    expect(isWorkletsHealthy()).toBe(false);
    expect(isSkiaAvailable()).toBe(false);
    expect(isGraphAvailable()).toBe(false);
    expect(isKlineChartAvailable()).toBe(false);
    expect(isEchartsSkiaAvailable()).toBe(false);
    await expect(probeChartEngines()).resolves.toEqual({
      klineChart: false,
      echartsSkia: false,
      graph: false,
    });
  });
});
