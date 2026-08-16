import { buildIndicatorOverlay, maLine, isIndicatorValid, emaLine } from '@/features/stock/indicatorsOverlay';
import {
  toValuationView,
  indexValuations,
  extractMetrics,
  latestReport,
  fmtMetric,
  fmtLarge,
  computeDerivedMetrics,
  computeEarningsGrowthPct,
  fmtPct,
} from '@/features/stock/fundamentals';
import { resampleKline } from '@/api/sources/HithsaApiSource';
import type { Candle, Valuation, FinancialReport, Symbol } from '@/api';

function mkCandles(n: number, base = 10): Candle[] {
  const arr: Candle[] = [];
  for (let i = 1; i <= n; i++) {
    const c = base + i;
    arr.push({
      datetime: i * 86400000,
      open: c,
      high: c + 1,
      low: c - 1,
      close: c,
      volume: 1000 + i * 10,
      amount: (c) * (1000 + i * 10),
    });
  }
  return arr;
}

const SYM: Symbol = { code: '600519', exchange: 'SH', name: '贵州茅台' };

describe('indicatorsOverlay', () => {
  it('buildIndicatorOverlay 返回与 K 线等长的多组指标', () => {
    const cs = mkCandles(60);
    const ov = buildIndicatorOverlay(cs);
    expect(ov.mas.length).toBe(4);
    expect(ov.mas[0].line.values.length).toBe(60);
    expect(ov.macd.dif.length).toBe(60);
    expect(ov.kdj.k.length).toBe(60);
    expect(ov.boll.upper.length).toBe(60);
    expect(ov.rsi.values.length).toBe(60);
    expect(ov.volume.length).toBe(60);
    expect(ov.volume[0]).toBe(1010);
  });

  it('前导不足处为 NaN，后期为有限数', () => {
    const cs = mkCandles(30);
    const ov = buildIndicatorOverlay(cs, { maPeriods: [5] });
    const ma5 = maLine(ov, 5);
    expect(Number.isNaN(ma5[3])).toBe(true);
    expect(isIndicatorValid(ma5[4])).toBe(true);
    expect(Number.isNaN(ma5[29])).toBe(false);
  });

  it('maLine 找不到周期返回空数组', () => {
    const ov = buildIndicatorOverlay(mkCandles(30));
    expect(maLine(ov, 999)).toEqual([]);
  });

  it('emaLine 等长且后期有效', () => {
    const cs = mkCandles(40);
    const e = emaLine(cs, 12);
    expect(e.length).toBe(40);
    expect(isIndicatorValid(e[20])).toBe(true);
  });

  it('自定义 options 生效', () => {
    const cs = mkCandles(60);
    const ov = buildIndicatorOverlay(cs, { maPeriods: [3, 8], rsiPeriod: 6, boll: { period: 10, k: 1.5 } });
    expect(ov.mas.map((m) => m.period)).toEqual([3, 8]);
    expect(Number.isNaN(ov.rsi.values[5])).toBe(true);
    expect(isIndicatorValid(ov.rsi.values[6])).toBe(true);
  });
});

describe('fundamentals', () => {
  const val: Valuation = {
    symbol: SYM,
    name: '茅台',
    peTtm: 35.2,
    peMrq: null,
    pbMrq: 9.1,
    psTtm: 12.3,
    pcfTtm: 20,
    timestamp: 1000,
  };

  it('toValuationView 安全转换，缺失为 null', () => {
    const v = toValuationView(val);
    expect(v.peTtm).toBe(35.2);
    expect(v.peMrq).toBeNull();
    expect(v.pbMrq).toBe(9.1);
  });

  it('indexValuations 按 code 建索引', () => {
    const m = indexValuations([val]);
    expect(m.get('600519')?.peTtm).toBe(35.2);
    expect(m.get('000001')).toBeUndefined();
  });

  it('extractMetrics 从松散财报安全提取', () => {
    const r: FinancialReport = {
      basicEps: 4.5,
      operatingIncome: 100_0000_0000,
      netProfit: 50_0000_0000,
      parentHolderNetProfit: 48_0000_0000,
      totalAssets: 200_0000_0000,
      holderEquityTotal: 150_0000_0000,
      operatingCashFlow: 30_0000_0000,
    };
    const m = extractMetrics(r);
    expect(m.eps).toBe(4.5);
    expect(m.netProfit).toBe(50_0000_0000);
    expect(m.equity).toBe(150_0000_0000);
    expect(m.operatingCashFlow).toBe(30_0000_0000);
  });

  it('extractMetrics 缺失字段返回 null', () => {
    const m = extractMetrics({});
    expect(m.eps).toBeNull();
    expect(m.netProfit).toBeNull();
  });

  it('latestReport 按 periodEndMs 取最新', () => {
    const reports: FinancialReport[] = [
      { periodEndMs: 100, netProfit: 10 },
      { periodEndMs: 300, netProfit: 30 },
      { periodEndMs: 200, netProfit: 20 },
    ];
    const m = latestReport(reports);
    expect(m?.netProfit).toBe(30);
  });

  it('latestReport 空数组返回 null', () => {
    expect(latestReport([])).toBeNull();
  });

  it('fmtMetric null → --，否则按精度', () => {
    expect(fmtMetric(null)).toBe('--');
    expect(fmtMetric(1234.567, { digits: 2 })).toBe('1,234.57');
    expect(fmtMetric(100, { scale: 0.01, digits: 2 })).toBe('1');
  });

  it('fmtLarge 亿/万缩写', () => {
    expect(fmtLarge(null)).toBe('--');
    expect(fmtLarge(120_0000_0000)).toBe('120.00亿');
    expect(fmtLarge(12_0000)).toBe('12.00万');
    expect(fmtLarge(999)).toBe('999.00');
  });

  it('fmtPct 比率转百分比', () => {
    expect(fmtPct(null)).toBe('--');
    expect(fmtPct(0.15)).toBe('15.00%');
    expect(fmtPct(0)).toBe('0.00%');
  });
});

describe('computeDerivedMetrics 派生估值指标', () => {
  const val: Valuation = {
    symbol: SYM,
    name: '茅台',
    peTtm: 35.2,
    peMrq: null,
    pbMrq: 9.1,
    psTtm: 12.3,
    pcfTtm: 20,
    timestamp: 1000,
  };
  const report: FinancialReport = {
    basicEps: 4.5,
    operatingIncome: 100_0000_0000,
    operatingCosts: 30_0000_0000,
    netProfit: 50_0000_0000,
    parentHolderNetProfit: 48_0000_0000,
    totalAssets: 200_0000_0000,
    holderEquityTotal: 150_0000_0000,
    operatingCashFlow: 30_0000_0000,
  };
  const valView = toValuationView(val);
  const metrics = extractMetrics(report);

  it('ROE = 净利润/净资产', () => {
    const d = computeDerivedMetrics(valView, metrics);
    expect(d.roe).toBeCloseTo(50 / 150, 6);
  });

  it('毛利率 = (营收−成本)/营收', () => {
    const d = computeDerivedMetrics(valView, metrics);
    expect(d.grossMargin).toBeCloseTo((100 - 30) / 100, 6);
  });

  it('净利率 = 净利润/营收', () => {
    const d = computeDerivedMetrics(valView, metrics);
    expect(d.netMargin).toBeCloseTo(50 / 100, 6);
  });

  it('PEG = PE / 盈利增速(%)', () => {
    const d = computeDerivedMetrics(valView, metrics, { earningsGrowthPct: 20 });
    expect(d.peg).toBeCloseTo(35.2 / 20, 6);
  });

  it('缺失估值或增速时 PEG 为 null', () => {
    expect(computeDerivedMetrics(null, metrics, { earningsGrowthPct: 20 }).peg).toBeNull();
    expect(computeDerivedMetrics(valView, metrics).peg).toBeNull();
  });

  it('净资产为 0 时 ROE 兜底为 null', () => {
    const m2 = extractMetrics({ netProfit: 10, holderEquityTotal: 0 });
    expect(computeDerivedMetrics(valView, m2).roe).toBeNull();
  });
});

describe('computeEarningsGrowthPct 盈利同比增速', () => {
  it('最近两期净利同比为正', () => {
    const reports: FinancialReport[] = [
      { periodEndMs: 100, netProfit: 120 },
      { periodEndMs: 200, netProfit: 100 },
    ];
    // 注意：按 periodEndMs 降序，最新=120(periodEndMs100?)，这里验证取「较大 periodEndMs」为最新
    // periodEndMs 200 > 100 → 最新=100 期净利=100? 重新构造：让 periodEndMs 大的净利润也大
    const r2: FinancialReport[] = [
      { periodEndMs: 200, netProfit: 120 },
      { periodEndMs: 100, netProfit: 100 },
    ];
    expect(computeEarningsGrowthPct(r2)).toBeCloseTo(20, 6);
  });

  it('增速为负', () => {
    const reports: FinancialReport[] = [
      { periodEndMs: 200, netProfit: 80 },
      { periodEndMs: 100, netProfit: 100 },
    ];
    expect(computeEarningsGrowthPct(reports)).toBeCloseTo(-20, 6);
  });

  it('样本不足返回 null', () => {
    expect(computeEarningsGrowthPct([{ periodEndMs: 200, netProfit: 100 }])).toBeNull();
    expect(computeEarningsGrowthPct([])).toBeNull();
  });

  it('上一期净利非正返回 null', () => {
    const reports: FinancialReport[] = [
      { periodEndMs: 200, netProfit: 120 },
      { periodEndMs: 100, netProfit: 0 },
    ];
    expect(computeEarningsGrowthPct(reports)).toBeNull();
  });

  it('净利缺失或 periodEndMs 缺失被过滤', () => {
    const reports: FinancialReport[] = [
      { periodEndMs: 200, netProfit: 120 },
      { periodEndMs: 100 },
      { netProfit: 100 },
      { periodEndMs: 50, netProfit: 100 },
    ];
    // 仅 periodEndMs=200 与 50 有效，且 50<200 → 最新=120，上一期=100
    expect(computeEarningsGrowthPct(reports)).toBeCloseTo(20, 6);
  });
});

describe('resampleKline 日线聚合周/月', () => {
  const daily = (iso: string, o: number, h: number, l: number, c: number, v: number): Candle => ({
    datetime: new Date(iso).toISOString(),
    open: o,
    high: h,
    low: l,
    close: c,
    volume: v,
    amount: v * c,
  });

  it('空输入返回空', () => {
    expect(resampleKline([], 'week')).toEqual([]);
  });

  it('聚合为周K：OHLC/量按规则合并，datetime 取周五', () => {
    // 2024-01-01(一) ~ 2024-01-07(日) 一周
    const week = [
      daily('2024-01-01', 10, 11, 9, 10.5, 100),
      daily('2024-01-02', 10.5, 12, 10, 11.5, 120),
      daily('2024-01-03', 11.5, 11.8, 10.5, 11, 80),
      daily('2024-01-04', 11, 13, 10.8, 12.5, 200),
      daily('2024-01-05', 12.5, 13.5, 12, 13, 150),
    ];
    const w = resampleKline(week, 'week');
    expect(w).toHaveLength(1);
    expect(w[0].open).toBe(10);
    expect(w[0].high).toBe(13.5);
    expect(w[0].low).toBe(9);
    expect(w[0].close).toBe(13);
    expect(w[0].volume).toBe(100 + 120 + 80 + 200 + 150);
    expect(new Date(w[0].datetime).getUTCDay()).toBe(5); // 周五
  });

  it('两周分别聚合成两根周K，按时间升序', () => {
    const arr = [
      daily('2024-01-01', 10, 11, 9, 10, 100), // 第1周
      daily('2024-01-08', 10, 12, 9.5, 11, 90), // 第2周(1/8为周一)
      daily('2024-01-09', 11, 13, 10, 12, 110),
    ];
    const w = resampleKline(arr, 'week');
    expect(w).toHaveLength(2);
    expect(w[0].close).toBe(10);
    expect(w[1].close).toBe(12);
    expect(new Date(w[0].datetime).getTime()).toBeLessThan(new Date(w[1].datetime).getTime());
  });

  it('聚合为月K：按自然月分组', () => {
    const arr = [
      daily('2024-01-29', 10, 11, 9, 10.5, 100),
      daily('2024-01-31', 10.5, 12, 10, 11.5, 120),
      daily('2024-02-01', 11.5, 13, 11, 12.5, 200),
    ];
    const m = resampleKline(arr, 'month');
    expect(m).toHaveLength(2);
    expect(m[0].close).toBe(11.5); // 1月最后一根
    expect(m[1].close).toBe(12.5);
  });
});
