/**
 * useSimAccount —— 模拟盘账户状态 Hook。
 * 封装 SimAccountRepo 的读取/提交/重置，并提供基于实时行情的盈亏汇总。
 */
import { useCallback, useEffect, useState } from 'react';
import type { Quote, Symbol } from '@/api';
import { SimAccountRepo } from '@/simulation';
import { summarize, symbolKey, type PortfolioSummary } from '@/simulation';
import type { SimAccount, Side, OrderType, SimPosition, Order, Trade, SubmitResult } from '@/simulation';

export function useSimAccount(quotes?: Quote[] | null): {
  account: SimAccount | null;
  summary: PortfolioSummary | null;
  refresh: () => Promise<void>;
  buy: (symbol: Symbol, price: number, quantity: number, type?: OrderType, refPrice?: number) => Promise<SubmitResult>;
  sell: (symbol: Symbol, price: number, quantity: number, type?: OrderType, refPrice?: number) => Promise<SubmitResult>;
  reset: (initCash?: number) => Promise<void>;
  positions: SimPosition[];
  orders: Order[];
  trades: Trade[];
} {
  const [account, setAccount] = useState<SimAccount | null>(null);

  const refresh = useCallback(async () => {
    const acc = await SimAccountRepo.get();
    setAccount(acc);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submit = useCallback(
    async (side: Side, symbol: Symbol, price: number, quantity: number, type?: OrderType, refPrice?: number) => {
      const { account: acc, result } = await SimAccountRepo.submit({ symbol, side, price, quantity, type, refPrice });
      setAccount(acc);
      return result;
    },
    [],
  );

  const buy = useCallback(
    (symbol: Symbol, price: number, quantity: number, type?: OrderType, refPrice?: number) =>
      submit('buy', symbol, price, quantity, type, refPrice),
    [submit],
  );
  const sell = useCallback(
    (symbol: Symbol, price: number, quantity: number, type?: OrderType, refPrice?: number) =>
      submit('sell', symbol, price, quantity, type, refPrice),
    [submit],
  );

  const reset = useCallback(async (initCash?: number) => {
    const acc = await SimAccountRepo.reset(initCash);
    setAccount(acc);
  }, []);

  const summary = account ? summarize(account, quotes ?? []) : null;
  const positions = account?.positions.filter((p) => p.shares > 0) ?? [];
  const orders = account?.orders ?? [];
  const trades = account?.trades ?? [];

  return { account, summary, refresh, buy, sell, reset, positions, orders, trades };
}

export { symbolKey };
