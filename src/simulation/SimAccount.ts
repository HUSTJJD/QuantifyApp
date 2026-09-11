/**
 * 模拟盘账户仓储（支持多实例）。
 * 每个实例是独立命名空间下的一个账户：默认账户（现有模拟盘）与每个「策略专属模拟盘」
 * 各自独立资金/持仓/成交。
 * 持久化落 SQLite sim_account / sim_position / sim_order / sim_trade 表（profileId = scope）。
 */
import type { Symbol } from '@/data/api';
import type { SimAccount, Order, SimPosition, Trade, Side, OrderType } from './types';
import { quantStore } from '@/data/db/QuantStore';
import { storage } from '@/data/db/storage';
import {
  submitOrder as engineSubmit,
  settleOvernight,
  DEFAULT_INIT_CASH,
  type SubmitInput,
  type SubmitResult,
} from './engine';
import { simSymbolKey } from '@/data/db/QuantStore';

const DEFAULT_SCOPE = '';
const LAST_SETTLE_PREFIX = 'sim_last_settle_v1';

export interface AccountRepo {
  get(): Promise<SimAccount>;
  reset(initCash?: number): Promise<SimAccount>;
  submit(input: Omit<SubmitInput, 'type'> & { type?: OrderType }): Promise<{ account: SimAccount; result: SubmitResult }>;
  listOrders(limit?: number, offset?: number): Promise<Order[]>;
  listTrades(limit?: number, offset?: number): Promise<Trade[]>;
  listPositions(): Promise<SimPosition[]>;
  positionOf(symbol: Symbol): Promise<SimPosition | null>;
}

function emptyAccount(initCash = DEFAULT_INIT_CASH): SimAccount {
  return {
    initCash,
    cash: initCash,
    frozen: 0,
    positions: [],
    orders: [],
    trades: [],
    initialized: true,
  };
}

/** 新建一个独立命名空间的账户仓储。默认账户调用 createAccountRepo()（不传 scope）。 */
export function createAccountRepo(scope?: string): AccountRepo {
  const profileId = scope ?? DEFAULT_SCOPE;
  const LAST_SETTLE_KEY = scope ? `${scope}.${LAST_SETTLE_PREFIX}` : LAST_SETTLE_PREFIX;
  const store = quantStore();

  /** 内存缓存，避免每次操作都读盘（每实例独立） */
  let cache: SimAccount | null = null;

  async function loadFromDb(): Promise<SimAccount> {
    const accRow = await store.getSimAccount(profileId);
    if (!accRow) return emptyAccount();
    const posRows = await store.listSimPositions(profileId);
    const orderRows = await store.listSimOrders(profileId, 500);
    const tradeRows = await store.listSimTrades(profileId, 500);
    return {
      initCash: accRow.initCash,
      cash: accRow.cash,
      frozen: accRow.frozen,
      initialized: accRow.initialized,
      positions: posRows.map((r) => ({
        symbol: { code: r.code, exchange: r.exchange as Symbol['exchange'] },
        shares: r.shares,
        available: r.available,
        costPrice: r.costPrice,
        todayBuy: r.todayBuy,
      })),
      orders: orderRows.map((r) => ({
        id: r.id,
        symbol: { code: r.code, exchange: r.exchange as Symbol['exchange'] },
        side: r.side as Order['side'],
        type: r.type as Order['type'],
        price: r.price,
        quantity: r.quantity,
        filledQty: r.filledQty,
        status: r.status as Order['status'],
        message: r.message || undefined,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      trades: tradeRows
        .slice()
        .reverse()
        .map((r) => ({
          id: r.id,
          orderId: r.orderId,
          symbol: { code: r.code, exchange: r.exchange as Symbol['exchange'] },
          side: r.side as Trade['side'],
          price: r.price,
          quantity: r.quantity,
          amount: r.amount,
          fee: r.fee,
          cashDelta: r.cashDelta,
          ts: r.ts,
        })),
    };
  }

  async function persistToDb(account: SimAccount): Promise<void> {
    const now = Date.now();
    await store.putSimAccount({
      profileId,
      initCash: account.initCash,
      cash: account.cash,
      frozen: account.frozen,
      initialized: account.initialized,
      updatedAt: now,
    });
    await store.deleteSimPositions(profileId);
    for (const p of account.positions) {
      if (p.shares <= 0) continue;
      await store.putSimPosition({
        profileId,
        symbolKey: simSymbolKey(p.symbol),
        code: p.symbol.code,
        exchange: p.symbol.exchange,
        shares: p.shares,
        available: p.available,
        costPrice: p.costPrice,
        todayBuy: p.todayBuy,
      });
    }
    // 只写最新 orders/trades（避免重复 upsert 全量）
    const lastOrder = account.orders[account.orders.length - 1];
    if (lastOrder) {
      await store.appendSimOrder({
        profileId,
        id: lastOrder.id,
        symbolKey: simSymbolKey(lastOrder.symbol),
        code: lastOrder.symbol.code,
        exchange: lastOrder.symbol.exchange,
        side: lastOrder.side,
        type: lastOrder.type,
        price: lastOrder.price,
        quantity: lastOrder.quantity,
        filledQty: lastOrder.filledQty,
        status: lastOrder.status,
        message: lastOrder.message ?? '',
        createdAt: lastOrder.createdAt,
        updatedAt: lastOrder.updatedAt,
      });
    }
    const lastTrade = account.trades[account.trades.length - 1];
    if (lastTrade) {
      await store.appendSimTrade({
        profileId,
        id: lastTrade.id,
        orderId: lastTrade.orderId,
        symbolKey: simSymbolKey(lastTrade.symbol),
        code: lastTrade.symbol.code,
        exchange: lastTrade.symbol.exchange,
        side: lastTrade.side,
        price: lastTrade.price,
        quantity: lastTrade.quantity,
        amount: lastTrade.amount,
        fee: lastTrade.fee,
        cashDelta: lastTrade.cashDelta,
        ts: lastTrade.ts,
      });
    }
  }

  async function load(): Promise<SimAccount> {
    if (cache) return cache;
    cache = await loadFromDb();
    await maybeSettle();
    return cache;
  }

  async function persist(account: SimAccount): Promise<void> {
    cache = account;
    await persistToDb(account);
  }

  /** 隔夜解锁：跨自然日时把今日买入转为可用 */
  async function maybeSettle(): Promise<void> {
    if (!cache) return;
    const today = new Date().toDateString();
    const last = await storage.getString(LAST_SETTLE_KEY);
    if (last === today) return;
    const settled = settleOvernight(cache.positions);
    cache = { ...cache, positions: settled };
    await storage.setString(LAST_SETTLE_KEY, today);
    await persistToDb(cache);
  }

  return {
    async get(): Promise<SimAccount> {
      return load();
    },
    async reset(initCash = DEFAULT_INIT_CASH): Promise<SimAccount> {
      const acc = emptyAccount(initCash);
      await store.clearSim(profileId);
      await persist(acc);
      return acc;
    },
    async submit(
      input: Omit<SubmitInput, 'type'> & { type?: OrderType },
    ): Promise<{ account: SimAccount; result: SubmitResult }> {
      const acc = await load();
      const { account, result } = engineSubmit(acc, input);
      await persist(account);
      return { account, result };
    },
    async listOrders(limit = 50, offset = 0): Promise<Order[]> {
      const acc = await load();
      return acc.orders.slice(offset, offset + limit);
    },
    async listTrades(limit = 50, offset = 0): Promise<Trade[]> {
      const acc = await load();
      return acc.trades.slice(offset, offset + limit);
    },
    async listPositions(): Promise<SimPosition[]> {
      const acc = await load();
      return acc.positions.filter((p) => p.shares > 0);
    },
    async positionOf(symbol: Symbol): Promise<SimPosition | null> {
      const acc = await load();
      return (
        acc.positions.find((p) => p.symbol.code === symbol.code && p.symbol.exchange === symbol.exchange) ??
        null
      );
    },
  };
}

/** 默认模拟盘账户（不传 scope，保留既有数据 key）。 */
export const SimAccountRepo: AccountRepo = createAccountRepo();

export type SimSide = Side;
