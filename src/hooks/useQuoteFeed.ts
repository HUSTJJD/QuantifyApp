/**
 * useQuoteFeed —— 订阅一组标的的「推送式」实时行情。
 * 内部走 QuoteFeed 常驻服务（交易时段自动轮询），组件挂载即订阅、卸载即退订。
 */
import { useEffect, useState, useCallback } from 'react';
import type { Symbol, Quote } from '@/api';
import { quoteFeed } from '@/services/QuoteFeed';

export function useQuoteFeed(symbols: Symbol[]): {
  quotes: Quote[];
  refresh: () => void;
} {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const key = JSON.stringify(symbols);

  useEffect(() => {
    const parsed: Symbol[] = key === '[]' ? [] : JSON.parse(key);
    if (parsed.length === 0) {
      setQuotes([]);
      return;
    }
    quoteFeed.subscribe(parsed);

    const update = () => {
      marketDataQuotes(parsed).then(setQuotes);
    };
    const unsub = quoteFeed.subscribeListener(update);
    update();
    return unsub;
  }, [key]);

  const refresh = useCallback(() => {
    quoteFeed.refreshNow();
  }, []);

  return { quotes, refresh };
}

// 直接读行情缓存（QuoteFeed 已写入），避免再发一次网络
import { marketData } from '@/api';
async function marketDataQuotes(symbols: Symbol[]): Promise<Quote[]> {
  return marketData.getQuotes(symbols);
}
