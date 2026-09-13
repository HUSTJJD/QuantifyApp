/**
 * backtestReport —— 回测报告纯文本导出格式。
 */
import type { BacktestResult } from '@/quant/backtest';
import type { StrategyProfile } from '@/quant/profile';
import {
  formatBacktestReport,
  formatPoolSection,
  formatDetailSection,
} from '@/quant/backtestReport';

function profileOf(): StrategyProfile {
  return {
    id: 'ma_cross',
    templateId: 'ma_cross',
    name: '均线金叉',
    note: '',
    enabled: true,
    autoTrade: false,
    params: {},
    selection: { universe: 'watchlist', priceMax: 0, minTurnoverWan: 0 },
    exit: { takeProfitPct: 10, stopLossPct: 5, trailingPct: 0 },
    trade: { session: 'any', period: 'day', positionRatio: 1 / 3, maxPositions: 1 },
    createdAt: 0,
    updatedAt: 0,
  };
}

function resultOf(over: Partial<BacktestResult> = {}): BacktestResult {
  return {
    trades: [
      { index: 1, time: Date.parse('2026-09-01T00:00:00+08:00'), side: 'buy', price: 10, shares: 100, fee: 5, cashAfter: 90000 },
      { index: 2, time: Date.parse('2026-09-05T00:00:00+08:00'), side: 'sell', price: 11, shares: 100, fee: 5.5, cashAfter: 100994.5 },
    ],
    equity: [100000, 100500, 101000],
    initCash: 100000,
    finalEquity: 101000,
    totalReturnPct: 1,
    annualizedReturnPct: 12,
    maxDrawdownPct: 3.2,
    sharpe: 1.1,
    winRate: 55,
    profitFactor: 1.4,
    totalFees: 10.5,
    corpEvents: [],
    ...over,
  };
}

describe('formatPoolSection', () => {
  it('空池输出提示', () => {
    expect(formatPoolSection([])).toContain('无成功结果');
  });

  it('汇总行含平均收益，明细含代码', () => {
    const text = formatPoolSection([
      { symbol: { code: '600519', exchange: 'SH' }, ok: true, result: resultOf() },
      { symbol: { code: '000001', exchange: 'SZ' }, ok: false, reason: '数据不足' },
    ]);
    expect(text).toContain('成功 1/2');
    expect(text).toContain('600519.SH');
    expect(text).toContain('+1.00%');
    expect(text).toContain('000001.SZ');
    expect(text).toContain('数据不足');
  });
});

describe('formatDetailSection', () => {
  it('含绩效 / 成交', () => {
    const text = formatDetailSection({
      symbol: { code: '600519', exchange: 'SH' },
      result: resultOf(),
      benchMetrics: {
        strategyReturnPct: 1,
        benchmarkReturnPct: 0.5,
        excessReturnPct: 0.5,
        annualizedExcessPct: 6,
        trackingErrorPct: 4,
        informationRatio: 1.5,
      },
      walk: {
        train: resultOf({ totalReturnPct: 8, sharpe: 1.2 }),
        val: resultOf({ totalReturnPct: -2, sharpe: 0.1 }),
        returnDecayPct: 125,
        sharpeDecayPct: 91,
        likelyOverfit: true,
      },
    });
    expect(text).toContain('详报');
    expect(text).toContain('+1.00%');
    expect(text).toContain('超额');
    expect(text).toContain('疑似过拟合');
    expect(text).toContain('买 100股');
  });
});

describe('formatBacktestReport', () => {
  it('完整报告含标题、策略名、滑点与免责声明', () => {
    const text = formatBacktestReport({
      profile: profileOf(),
      note: '自选前 5 只',
      slippageBp: 5,
      initCash: 100000,
      pool: [{ symbol: { code: '600519', exchange: 'SH' }, ok: true, result: resultOf() }],
      detail: {
        symbol: { code: '600519', exchange: 'SH' },
        result: resultOf(),
        benchMetrics: null,
        walk: null,
      },
      generatedAt: Date.parse('2026-09-13T10:00:00+08:00'),
    });
    expect(text).toContain('QuantifyApp 回测报告');
    expect(text).toContain('均线金叉');
    expect(text).toContain('滑点 5bp');
    expect(text).toContain('自选前 5 只');
    expect(text).toContain('导出时间：2026-09-13');
    expect(text).toContain('回测不等于未来收益');
  });

  it('无详报时只含池段', () => {
    const text = formatBacktestReport({
      profile: profileOf(),
      slippageBp: 0,
      initCash: 100000,
      pool: [],
    });
    expect(text).toContain('【池汇总】');
    expect(text).not.toContain('【详报');
  });
});
