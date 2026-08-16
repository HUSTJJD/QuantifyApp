/**
 * useSignals —— 读取当前全部买卖信号（来自 SignalStore）。
 * 配合行情推送，信号会随交易时段自动更新；这里做快照订阅，刷新时重读。
 */
import { useEffect, useState, useCallback } from 'react';
import type { TradeSignal } from '@/quant/signals';
import { getAll } from '@/quant/SignalStore';
import { quoteFeed } from '@/services/QuoteFeed';

export function useSignals(): {
  signals: TradeSignal[];
  buys: TradeSignal[];
  sells: TradeSignal[];
  reload: () => void;
} {
  const [signals, setSignals] = useState<TradeSignal[]>([]);

  const reload = useCallback(() => {
    getAll().then(setSignals);
  }, []);

  useEffect(() => {
    reload();
    const unsub = quoteFeed.subscribeListener(() => {
      // 行情刷新后信号可能变化，轻量重读
      getAll().then(setSignals);
    });
    return unsub;
  }, [reload]);

  const buys = signals.filter((s) => s.side === 'buy');
  const sells = signals.filter((s) => s.side === 'sell');

  return { signals, buys, sells, reload };
}
