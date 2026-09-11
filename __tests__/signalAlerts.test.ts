import {
  signalToAlertEvent,
  signalsToAlertEvents,
  signalRuleId,
} from '@/quant/signalAlerts';
import type { TradeSignal } from '@/quant/signals';

function makeSignal(
  side: TradeSignal['side'],
  strength: number,
  strategyId = 'ma_cross',
): TradeSignal {
  return {
    symbol: { code: '600000', exchange: 'SH', name: '测试' },
    symbolKey: '600000.SH',
    side,
    strength,
    reasons: ['MA金叉'],
    contributions: [{ id: strategyId, side, strength, weight: 1 }],
    ts: 1700000000000,
  };
}

describe('signalToAlertEvent', () => {
  it('hold 信号返回 null', () => {
    expect(signalToAlertEvent(makeSignal('hold', 0))).toBeNull();
  });

  it('强度不足返回 null', () => {
    expect(signalToAlertEvent(makeSignal('buy', 0.5))).toBeNull();
  });

  it('buy 信号转为 AlertEvent', () => {
    const e = signalToAlertEvent(makeSignal('buy', 2));
    expect(e).not.toBeNull();
    expect(e!.ruleId).toBe(signalRuleId('ma_cross'));
    expect(e!.value).toBe(2);
    expect(e!.message).toContain('买入');
    expect(e!.message).toContain('MA金叉');
    expect(e!.time).toBe(1700000000000);
  });

  it('sell 信号消息含卖出', () => {
    const e = signalToAlertEvent(makeSignal('sell', -1.5));
    expect(e!.message).toContain('卖出');
  });

  it('多策略时取强度最大者作为 ruleId', () => {
    const sig: TradeSignal = {
      ...makeSignal('buy', 2.5),
      contributions: [
        { id: 'ma_cross', side: 'buy', strength: 1, weight: 1 },
        { id: 'macd_cross', side: 'buy', strength: 2, weight: 1 },
      ],
    };
    const e = signalToAlertEvent(sig);
    expect(e!.ruleId).toBe(signalRuleId('macd_cross'));
  });
});

describe('signalsToAlertEvents', () => {
  it('批量转换过滤 hold', () => {
    const signals = [makeSignal('buy', 2), makeSignal('hold', 0), makeSignal('sell', -1)];
    const events = signalsToAlertEvents(signals);
    expect(events).toHaveLength(2);
  });

  it('按策略开关过滤', () => {
    const signals = [
      makeSignal('buy', 2, 'ma_cross'),
      makeSignal('buy', 2, 'macd_cross'),
    ];
    const events = signalsToAlertEvents(signals, new Set(['ma_cross']));
    expect(events).toHaveLength(1);
    expect(events[0].ruleId).toBe(signalRuleId('ma_cross'));
  });

  it('undefined 开关 = 全部允许', () => {
    const signals = [makeSignal('buy', 2, 'ma_cross'), makeSignal('buy', 2, 'macd_cross')];
    expect(signalsToAlertEvents(signals)).toHaveLength(2);
  });
});
