/**
 * QuantStore —— 核心量化数据表门面（缓存 / 信号 / 策略 / 模拟盘 / 跟单）。
 *
 * 设计：
 *  - 全部落 SQLite 专用表（见 schema.ts v4），禁止整包 JSON 塞 KV；
 *  - 复用 connection.ts 共享连接；jest / 无原生时回落内存 Map（静态共享）；
 *  - 业务层通过本类读写，不直接写 SQL。
 */
import type { DB, Scalar } from '@op-engineering/op-sqlite';
import type { Symbol } from '@/api';
import { getSqlite } from './connection';
import { toFullCode } from '@/domain/symbol';

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function bool(v: unknown): boolean {
  return v === 1 || v === true || v === '1';
}

/* ------------------------------ 类型 ------------------------------ */

export interface MethodCacheRow {
  cacheKey: string;
  method: string;
  argsHash: string;
  payload: string;
  updatedAt: number;
  expiresAt: number;
}

export interface QuoteCacheRow {
  cacheKey: string;
  symbols: string;
  payload: string;
  updatedAt: number;
  expiresAt: number;
}

export interface TradeSignalRow {
  symbolKey: string;
  code: string;
  exchange: string;
  side: string;
  strength: number;
  reasons: string[];
  details: string;
  ts: number;
}

export interface StrategyProfileRow {
  id: string;
  templateId: string;
  name: string;
  note: string;
  enabled: boolean;
  autoTrade: boolean;
  params: Record<string, number>;
  selection: Record<string, unknown>;
  exitRules: Record<string, unknown>;
  tradeRules: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface SimAccountRow {
  profileId: string;
  initCash: number;
  cash: number;
  frozen: number;
  initialized: boolean;
  updatedAt: number;
}

export interface SimPositionRow {
  profileId: string;
  symbolKey: string;
  code: string;
  exchange: string;
  shares: number;
  available: number;
  costPrice: number;
  todayBuy: number;
}

export interface SimOrderRow {
  profileId: string;
  id: string;
  symbolKey: string;
  code: string;
  exchange: string;
  side: string;
  type: string;
  price: number;
  quantity: number;
  filledQty: number;
  status: string;
  message: string;
  createdAt: number;
  updatedAt: number;
}

export interface SimTradeRow {
  profileId: string;
  id: string;
  orderId: string;
  symbolKey: string;
  code: string;
  exchange: string;
  side: string;
  price: number;
  quantity: number;
  amount: number;
  fee: number;
  cashDelta: number;
  ts: number;
}

export interface FollowedSignalRow {
  dedupeKey: string;
  symbolKey: string;
  side: string;
  createdAt: number;
}

/* ------------------------------ 内存回落 ------------------------------ */

class MemMaps {
  methodCache = new Map<string, MethodCacheRow>();
  quoteCache = new Map<string, QuoteCacheRow>();
  tradeSignal = new Map<string, TradeSignalRow>();
  strategyProfile = new Map<string, StrategyProfileRow>();
  simAccount = new Map<string, SimAccountRow>();
  simPosition = new Map<string, SimPositionRow>();
  simOrder = new Map<string, SimOrderRow>();
  simTrade = new Map<string, SimTradeRow>();
  followed = new Map<string, FollowedSignalRow>();
}
const mem = new MemMaps();

/* ------------------------------ 门面 ------------------------------ */

export class QuantStore {
  private async db(): Promise<DB | null> {
    return getSqlite();
  }

  // ---------- method_cache ----------

  async getMethodCache(cacheKey: string, now = Date.now()): Promise<MethodCacheRow | null> {
    const db = await this.db();
    if (!db) {
      const r = mem.methodCache.get(cacheKey);
      return r && r.expiresAt > now ? r : null;
    }
    const res = await db.execute(
      'SELECT * FROM method_cache WHERE cache_key = ? AND expires_at > ?',
      [cacheKey, now],
    );
    const row = res.rows?.[0] as Record<string, Scalar> | undefined;
    if (!row) return null;
    return {
      cacheKey: String(row.cache_key),
      method: String(row.method),
      argsHash: String(row.args_hash),
      payload: String(row.payload),
      updatedAt: num(row.updated_at),
      expiresAt: num(row.expires_at),
    };
  }

  async putMethodCache(row: MethodCacheRow): Promise<void> {
    const db = await this.db();
    if (!db) {
      mem.methodCache.set(row.cacheKey, row);
      return;
    }
    await db.execute(
      `INSERT OR REPLACE INTO method_cache
       (cache_key, method, args_hash, payload, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.cacheKey, row.method, row.argsHash, row.payload, row.updatedAt, row.expiresAt],
    );
  }

  async pruneMethodCache(now = Date.now()): Promise<number> {
    const db = await this.db();
    if (!db) {
      let n = 0;
      for (const [k, r] of mem.methodCache) {
        if (r.expiresAt < now) {
          mem.methodCache.delete(k);
          n += 1;
        }
      }
      return n;
    }
    const res = await db.execute('DELETE FROM method_cache WHERE expires_at < ?', [now]);
    return res.rowsAffected ?? 0;
  }

  async clearMethodCache(cacheKey: string): Promise<void> {
    const db = await this.db();
    if (!db) {
      mem.methodCache.delete(cacheKey);
      return;
    }
    await db.execute('DELETE FROM method_cache WHERE cache_key = ?', [cacheKey]);
  }

  // ---------- quote_cache ----------

  async getQuoteCache(cacheKey: string, maxAgeMs: number, now = Date.now()): Promise<string | null> {
    const db = await this.db();
    if (!db) {
      const r = mem.quoteCache.get(cacheKey);
      return r && now - r.updatedAt <= maxAgeMs ? r.payload : null;
    }
    const res = await db.execute(
      'SELECT payload, updated_at FROM quote_cache WHERE cache_key = ?',
      [cacheKey],
    );
    const row = res.rows?.[0] as Record<string, Scalar> | undefined;
    if (!row) return null;
    if (now - num(row.updated_at) > maxAgeMs) return null;
    return String(row.payload);
  }

  async putQuoteCache(row: QuoteCacheRow): Promise<void> {
    const db = await this.db();
    if (!db) {
      mem.quoteCache.set(row.cacheKey, row);
      return;
    }
    await db.execute(
      `INSERT OR REPLACE INTO quote_cache
       (cache_key, symbols, payload, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [row.cacheKey, row.symbols, row.payload, row.updatedAt, row.expiresAt],
    );
  }

  async pruneQuoteCache(ttlMs: number, now = Date.now()): Promise<number> {
    const cutoff = now - ttlMs;
    const db = await this.db();
    if (!db) {
      let n = 0;
      for (const [k, r] of mem.quoteCache) {
        if (r.updatedAt < cutoff) {
          mem.quoteCache.delete(k);
          n += 1;
        }
      }
      return n;
    }
    const res = await db.execute('DELETE FROM quote_cache WHERE updated_at < ?', [cutoff]);
    return res.rowsAffected ?? 0;
  }

  // ---------- trade_signal ----------

  async upsertSignal(row: TradeSignalRow): Promise<void> {
    const db = await this.db();
    if (!db) {
      mem.tradeSignal.set(row.symbolKey, row);
      return;
    }
    await db.execute(
      `INSERT OR REPLACE INTO trade_signal
       (symbol_key, code, exchange, side, strength, reasons, details, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.symbolKey,
        row.code,
        row.exchange,
        row.side,
        row.strength,
        JSON.stringify(row.reasons),
        row.details,
        row.ts,
      ],
    );
  }

  async listSignals(): Promise<TradeSignalRow[]> {
    const db = await this.db();
    if (!db) return [...mem.tradeSignal.values()];
    const res = await db.execute('SELECT * FROM trade_signal ORDER BY ts DESC');
    return (res.rows ?? []).map((r) => {
      const row = r as Record<string, Scalar>;
      let reasons: string[] = [];
      try {
        reasons = JSON.parse(String(row.reasons)) as string[];
      } catch {
        reasons = [];
      }
      return {
        symbolKey: String(row.symbol_key),
        code: String(row.code),
        exchange: String(row.exchange),
        side: String(row.side),
        strength: num(row.strength),
        reasons: Array.isArray(reasons) ? reasons : [],
        details: String(row.details ?? ''),
        ts: num(row.ts),
      };
    });
  }

  // ---------- strategy_profile ----------

  async listProfiles(): Promise<StrategyProfileRow[]> {
    const db = await this.db();
    if (!db) return [...mem.strategyProfile.values()].sort((a, b) => a.createdAt - b.createdAt);
    const res = await db.execute('SELECT * FROM strategy_profile ORDER BY created_at ASC');
    return (res.rows ?? []).map((r) => this.mapProfile(r as Record<string, Scalar>));
  }

  async getProfile(id: string): Promise<StrategyProfileRow | null> {
    const db = await this.db();
    if (!db) return mem.strategyProfile.get(id) ?? null;
    const res = await db.execute('SELECT * FROM strategy_profile WHERE id = ?', [id]);
    const row = res.rows?.[0] as Record<string, Scalar> | undefined;
    return row ? this.mapProfile(row) : null;
  }

  async upsertProfile(row: StrategyProfileRow): Promise<void> {
    const db = await this.db();
    if (!db) {
      mem.strategyProfile.set(row.id, row);
      return;
    }
    await db.execute(
      `INSERT OR REPLACE INTO strategy_profile
       (id, template_id, name, note, enabled, auto_trade, params, selection, exit_rules, trade_rules, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.templateId,
        row.name,
        row.note,
        row.enabled ? 1 : 0,
        row.autoTrade ? 1 : 0,
        JSON.stringify(row.params),
        JSON.stringify(row.selection),
        JSON.stringify(row.exitRules),
        JSON.stringify(row.tradeRules),
        row.createdAt,
        row.updatedAt,
      ],
    );
  }

  async deleteProfile(id: string): Promise<void> {
    const db = await this.db();
    if (!db) {
      mem.strategyProfile.delete(id);
      return;
    }
    await db.execute('DELETE FROM strategy_profile WHERE id = ?', [id]);
  }

  private mapProfile(r: Record<string, Scalar>): StrategyProfileRow {
    const parse = <T>(s: unknown, d: T): T => {
      try {
        return JSON.parse(String(s)) as T;
      } catch {
        return d;
      }
    };
    return {
      id: String(r.id),
      templateId: String(r.template_id),
      name: String(r.name),
      note: String(r.note ?? ''),
      enabled: bool(r.enabled),
      autoTrade: bool(r.auto_trade),
      params: parse<Record<string, number>>(r.params, {}),
      selection: parse<Record<string, unknown>>(r.selection, {}),
      exitRules: parse<Record<string, unknown>>(r.exit_rules, {}),
      tradeRules: parse<Record<string, unknown>>(r.trade_rules, {}),
      createdAt: num(r.created_at),
      updatedAt: num(r.updated_at),
    };
  }

  // ---------- sim_account / position / order / trade ----------

  async getSimAccount(profileId: string): Promise<SimAccountRow | null> {
    const db = await this.db();
    if (!db) return mem.simAccount.get(profileId) ?? null;
    const res = await db.execute('SELECT * FROM sim_account WHERE profile_id = ?', [profileId]);
    const r = res.rows?.[0] as Record<string, Scalar> | undefined;
    if (!r) return null;
    return {
      profileId: String(r.profile_id),
      initCash: num(r.init_cash),
      cash: num(r.cash),
      frozen: num(r.frozen),
      initialized: bool(r.initialized),
      updatedAt: num(r.updated_at),
    };
  }

  async putSimAccount(row: SimAccountRow): Promise<void> {
    const db = await this.db();
    if (!db) {
      mem.simAccount.set(row.profileId, row);
      return;
    }
    await db.execute(
      `INSERT OR REPLACE INTO sim_account
       (profile_id, init_cash, cash, frozen, initialized, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.profileId, row.initCash, row.cash, row.frozen, row.initialized ? 1 : 0, row.updatedAt],
    );
  }

  async listSimPositions(profileId: string): Promise<SimPositionRow[]> {
    const db = await this.db();
    if (!db) {
      return [...mem.simPosition.values()].filter((p) => p.profileId === profileId);
    }
    const res = await db.execute('SELECT * FROM sim_position WHERE profile_id = ?', [profileId]);
    return (res.rows ?? []).map((r) => {
      const row = r as Record<string, Scalar>;
      return {
        profileId: String(row.profile_id),
        symbolKey: String(row.symbol_key),
        code: String(row.code),
        exchange: String(row.exchange),
        shares: num(row.shares),
        available: num(row.available),
        costPrice: num(row.cost_price),
        todayBuy: num(row.today_buy),
      };
    });
  }

  async putSimPosition(row: SimPositionRow): Promise<void> {
    const db = await this.db();
    if (!db) {
      mem.simPosition.set(`${row.profileId}|${row.symbolKey}`, row);
      return;
    }
    await db.execute(
      `INSERT OR REPLACE INTO sim_position
       (profile_id, symbol_key, code, exchange, shares, available, cost_price, today_buy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.profileId,
        row.symbolKey,
        row.code,
        row.exchange,
        row.shares,
        row.available,
        row.costPrice,
        row.todayBuy,
      ],
    );
  }

  async deleteSimPositions(profileId: string): Promise<void> {
    const db = await this.db();
    if (!db) {
      for (const [k, r] of mem.simPosition) {
        if (r.profileId === profileId) mem.simPosition.delete(k);
      }
      return;
    }
    await db.execute('DELETE FROM sim_position WHERE profile_id = ?', [profileId]);
  }

  async appendSimOrder(row: SimOrderRow): Promise<void> {
    const db = await this.db();
    if (!db) {
      mem.simOrder.set(`${row.profileId}|${row.id}`, row);
      return;
    }
    await db.execute(
      `INSERT OR REPLACE INTO sim_order
       (profile_id, id, symbol_key, code, exchange, side, type, price, quantity, filled_qty, status, message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.profileId,
        row.id,
        row.symbolKey,
        row.code,
        row.exchange,
        row.side,
        row.type,
        row.price,
        row.quantity,
        row.filledQty,
        row.status,
        row.message,
        row.createdAt,
        row.updatedAt,
      ],
    );
  }

  async listSimOrders(profileId: string, limit = 200): Promise<SimOrderRow[]> {
    const db = await this.db();
    if (!db) {
      return [...mem.simOrder.values()]
        .filter((o) => o.profileId === profileId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    }
    const res = await db.execute(
      'SELECT * FROM sim_order WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?',
      [profileId, limit],
    );
    return (res.rows ?? []).map((r) => {
      const row = r as Record<string, Scalar>;
      return {
        profileId: String(row.profile_id),
        id: String(row.id),
        symbolKey: String(row.symbol_key),
        code: String(row.code),
        exchange: String(row.exchange),
        side: String(row.side),
        type: String(row.type),
        price: num(row.price),
        quantity: num(row.quantity),
        filledQty: num(row.filled_qty),
        status: String(row.status),
        message: String(row.message ?? ''),
        createdAt: num(row.created_at),
        updatedAt: num(row.updated_at),
      };
    });
  }

  async appendSimTrade(row: SimTradeRow): Promise<void> {
    const db = await this.db();
    if (!db) {
      mem.simTrade.set(`${row.profileId}|${row.id}`, row);
      return;
    }
    await db.execute(
      `INSERT OR REPLACE INTO sim_trade
       (profile_id, id, order_id, symbol_key, code, exchange, side, price, quantity, amount, fee, cash_delta, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.profileId,
        row.id,
        row.orderId,
        row.symbolKey,
        row.code,
        row.exchange,
        row.side,
        row.price,
        row.quantity,
        row.amount,
        row.fee,
        row.cashDelta,
        row.ts,
      ],
    );
  }

  async listSimTrades(profileId: string, limit = 200): Promise<SimTradeRow[]> {
    const db = await this.db();
    if (!db) {
      return [...mem.simTrade.values()]
        .filter((t) => t.profileId === profileId)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, limit);
    }
    const res = await db.execute(
      'SELECT * FROM sim_trade WHERE profile_id = ? ORDER BY ts DESC LIMIT ?',
      [profileId, limit],
    );
    return (res.rows ?? []).map((r) => {
      const row = r as Record<string, Scalar>;
      return {
        profileId: String(row.profile_id),
        id: String(row.id),
        orderId: String(row.order_id),
        symbolKey: String(row.symbol_key),
        code: String(row.code),
        exchange: String(row.exchange),
        side: String(row.side),
        price: num(row.price),
        quantity: num(row.quantity),
        amount: num(row.amount),
        fee: num(row.fee),
        cashDelta: num(row.cash_delta),
        ts: num(row.ts),
      };
    });
  }

  async clearSim(profileId: string): Promise<void> {
    await this.deleteSimPositions(profileId);
    const db = await this.db();
    if (!db) {
      mem.simAccount.delete(profileId);
      for (const [k, r] of mem.simOrder) if (r.profileId === profileId) mem.simOrder.delete(k);
      for (const [k, r] of mem.simTrade) if (r.profileId === profileId) mem.simTrade.delete(k);
      return;
    }
    await db.execute('DELETE FROM sim_account WHERE profile_id = ?', [profileId]);
    await db.execute('DELETE FROM sim_order WHERE profile_id = ?', [profileId]);
    await db.execute('DELETE FROM sim_trade WHERE profile_id = ?', [profileId]);
  }

  // ---------- followed_signal ----------

  async hasFollowed(dedupeKey: string): Promise<boolean> {
    const db = await this.db();
    if (!db) return mem.followed.has(dedupeKey);
    const res = await db.execute('SELECT 1 FROM followed_signal WHERE dedupe_key = ?', [dedupeKey]);
    return (res.rows?.length ?? 0) > 0;
  }

  async markFollowed(row: FollowedSignalRow): Promise<void> {
    const db = await this.db();
    if (!db) {
      mem.followed.set(row.dedupeKey, row);
      return;
    }
    await db.execute(
      `INSERT OR REPLACE INTO followed_signal (dedupe_key, symbol_key, side, created_at)
       VALUES (?, ?, ?, ?)`,
      [row.dedupeKey, row.symbolKey, row.side, row.createdAt],
    );
  }

  async listFollowed(): Promise<FollowedSignalRow[]> {
    const db = await this.db();
    if (!db) return [...mem.followed.values()];
    const res = await db.execute('SELECT * FROM followed_signal');
    return (res.rows ?? []).map((r) => {
      const row = r as Record<string, Scalar>;
      return {
        dedupeKey: String(row.dedupe_key),
        symbolKey: String(row.symbol_key),
        side: String(row.side),
        createdAt: num(row.created_at),
      };
    });
  }

  // ---------- 测试辅助 ----------

  /** 仅测试：重置内存回落状态 */
  static resetMemory(): void {
    mem.methodCache.clear();
    mem.quoteCache.clear();
    mem.tradeSignal.clear();
    mem.strategyProfile.clear();
    mem.simAccount.clear();
    mem.simPosition.clear();
    mem.simOrder.clear();
    mem.simTrade.clear();
    mem.followed.clear();
  }
}

let _store: QuantStore | null = null;
export function quantStore(): QuantStore {
  if (!_store) _store = new QuantStore();
  return _store;
}
export function resetQuantStore(): void {
  _store = null;
  QuantStore.resetMemory();
}

/** Symbol → 表内 symbol_key（exchange.code） */
export function simSymbolKey(s: Symbol): string {
  return toFullCode(s);
}
