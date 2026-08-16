/**
 * 模拟盘账户仓储（支持多实例）。
 * 每个实例是独立命名空间下的一个账户：默认账户（现有模拟盘）与每个「策略专属模拟盘」
 * 各自独立资金/持仓/成交，存储 key 隔离互不影响。
 * 持久化使用 storage 抽象（AsyncStorage / 内存），不依赖 RN 运行时，可单测。
 */
import type { Symbol } from '@/api';
import type { SimAccount, Order, SimPosition, Trade, Side, OrderType } from './types';
import { storage } from '@/db/storage';
import {
  submitOrder as engineSubmit,
  settleOvernight,
  DEFAULT_INIT_CASH,
  type SubmitInput,
  type SubmitResult,
} from './engine';

const DEFAULT_KEY = 'sim_account_v1';
const DEFAULT_LAST_SETTLE_KEY = 'sim_last_settle_v1';

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
  const KEY = scope ? `${scope}.sim_account_v1` : DEFAULT_KEY;
  const LAST_SETTLE_KEY = scope ? `${scope}.sim_last_settle_v1` : DEFAULT_LAST_SETTLE_KEY;

  /** 内存缓存，避免每次操作都读盘（每实例独立） */
  let cache: SimAccount | null = null;

  async function load(): Promise<SimAccount> {
    if (cache) return cache;
    const raw = await storage.getObject<SimAccount>(KEY);
    if (raw) {
      try {
        cache = raw;
        await maybeSettle();
        return cache;
      } catch {
        // 损坏数据忽略，重建
      }
    }
    cache = emptyAccount();
    await persist(cache);
    return cache;
  }

  async function persist(account: SimAccount): Promise<void> {
    cache = account;
    await storage.setObject(KEY, account);
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
    await storage.setObject(KEY, cache);
  }

  return {
    async get(): Promise<SimAccount> {
      return load();
    },
    async reset(initCash = DEFAULT_INIT_CASH): Promise<SimAccount> {
      const acc = emptyAccount(initCash);
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
        acc.positions.find((p) => p.symbol.code === symbol.code && p.symbol.exchange === symbol.exchange) ?? null
      );
    },
  };
}

/** 默认模拟盘账户（不传 scope，保留既有数据 key）。 */
export const SimAccountRepo: AccountRepo = createAccountRepo();

export type SimSide = Side;
