import { gradeSignalHint, isHintActionable, confirmSignal, signalToAlertEvent } from '@/quant/signalAlerts';
import type { TradeSignal } from '@/domain';

const base: TradeSignal = {
  symbol: { code: '600519', exchange: 'SH' },
  symbolKey: 'SH.600519',
  side: 'buy',
  strength: 2,
  profileId: 'sp_1',
  profileName: '趋势确认',
  reasons: ['均线金叉'],
  contributions: [
    { templateId: 'trend_confirm', label: '趋势确认', side: 'buy', strength: 2, weight: 1, reason: '均线金叉' },
  ],
  ts: Date.now(),
};

describe('signal alerts', () => {
  it('grades buy/sell by holdings', () => {
    expect(gradeSignalHint(base, 0).action).toBe('买入');
    expect(gradeSignalHint(base, 100).action).toBe('加仓');
    expect(gradeSignalHint({ ...base, side: 'sell' }, 0).actionable).toBe(false);
    expect(gradeSignalHint({ ...base, side: 'sell', strength: 3 }, 200).action).toBe('卖出');
  });

  it('gates sell when flat', () => {
    expect(isHintActionable({ ...base, side: 'sell' }, { heldQty: 0 })).toBe(false);
  });

  it('confirmSignal requires consecutive same side', () => {
    expect(confirmSignal(['buy', 'buy'], base, 2)).toBe(true);
    expect(confirmSignal(['sell', 'buy'], base, 2)).toBe(false);
  });

  it('signalToAlertEvent uses profile id as rule', () => {
    const e = signalToAlertEvent(base, 1, { heldQtyByKey: new Map([['SH.600519', 0]]) });
    expect(e?.ruleId).toBe('signal_sp_1');
  });
});
