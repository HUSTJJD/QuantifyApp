/**
 * 调度 / 决策卡 / 行业归因 单测。
 */
import { parseCronExpression, nextCronOccurrence, computeNextRunAt } from '@/quant/scheduler/nextRun';
import { scoreGrade, buildDecisionSummary, compositeFromSignals } from '@/quant/decisionCard';
import { computeIndustryAttribution } from '@/quant/industryAttribution';
import type { TradeSignal } from '@/quant/signals';
import type { PositionPnl } from '@/quant/portfolioPerf';

describe('scheduler nextRun', () => {
  it('parses 5-field cron', () => {
    const p = parseCronExpression('30 14 * * 1-5');
    expect(p?.minutes).toEqual([30]);
    expect(p?.hours).toEqual([14]);
    expect(p?.weekdays).toEqual([1, 2, 3, 4, 5]);
  });

  it('computes next cron occurrence', () => {
    const from = new Date('2026-09-12T10:00:00');
    const n = nextCronOccurrence('30 14 * * 1-5', from);
    expect(n).toBeTruthy();
    expect(n!.getHours()).toBe(14);
    expect(n!.getMinutes()).toBe(30);
  });

  it('interval next run', () => {
    const from = new Date('2026-09-12T10:00:00');
    const n = computeNextRunAt('interval', { every_sec: 60, anchor: from.toISOString() }, from);
    expect(n).toBeTruthy();
    expect(n!.getTime()).toBeGreaterThan(from.getTime());
  });
});

describe('decision card', () => {
  it('maps score to grade', () => {
    expect(scoreGrade(2.5)).toBe('A');
    expect(scoreGrade(-2)).toBe('D');
  });

  it('builds summary from signals', () => {
    const sig: TradeSignal = {
      symbol: { code: '600519', exchange: 'SH' },
      symbolKey: '600519.SH',
      side: 'buy',
      strength: 1.5,
      reasons: ['MACD 金叉'],
      contributions: [],
      ts: Date.now(),
    };
    const s = buildDecisionSummary([sig]);
    expect(s.grade).toBe('B+');
    expect(s.thesis[0]).toContain('MACD');
    expect(s.bias.label).toBe('偏多');
    expect(compositeFromSignals([sig])).toBeCloseTo(1.5);
  });
});

describe('industry attribution', () => {
  it('aggregates by industry', () => {
    const pos = [
      {
        symbol: { code: '600519', exchange: 'SH' as const },
        shares: 100,
        costPrice: 10,
        lastPrice: 12,
        value: 1200,
        cost: 1000,
        pnl: 200,
        pnlPct: 20,
        weight: 0.6,
      },
      {
        symbol: { code: '000001', exchange: 'SZ' as const },
        shares: 100,
        costPrice: 10,
        lastPrice: 9,
        value: 900,
        cost: 1000,
        pnl: -100,
        pnlPct: -10,
        weight: 0.4,
      },
    ] as PositionPnl[];
    const items = computeIndustryAttribution(pos, (c) => (c === '600519' ? '白酒' : '银行'));
    expect(items[0].industry).toBe('白酒');
    expect(items.find((i) => i.industry === '银行')?.pnl).toBe(-100);
  });
});
