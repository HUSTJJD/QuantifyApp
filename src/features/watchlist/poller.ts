/**
 * 自选股实时推送服务（方向4：轮询 + 本地通知）。
 *
 * 设计目标：
 *  - 纯函数核心 `evaluateWatchlist`：注入行情快照，跑异动规则，产出「本次新事件」。
 *    便于单测，不依赖定时器 / 网络 / 通知。
 *  - `WatchlistPoller`：定时拉取自选股行情，调用核心求值，对新增事件落盘
 *    （recordAlerts）并回调通知（onAlert，业务层据此弹本地通知 / 红点）。
 *
 * 不引入原生通知依赖；通知能力通过 `notify` 回调注入，便于在 UI 层用
 * react-native 的 Alert / 第三方通知库实现，也便于测试时传桩。
 */
import { marketData } from '@/data/api';
import type { Symbol, Quote, Candle } from '@/data/api';
import {
  detectAlerts,
  DEFAULT_ALERT_RULES,
  ruleNeedsCandles,
  type AlertRule,
  type AlertEvent,
} from './alerts';
import { getAllAlertRules } from './userAlertRules';
import { getWatchlist } from '@/data/repositories/WatchlistRepository';
import { recordAlerts, dedupeKey, getAlertHistory } from './alertHistory';
import { shouldSkipNotify, markNotified, getBackoff, recordBackoffFailure, recordBackoffSuccess } from './alertLifecycle';
import { getCandlesLocal } from '@/data/db/KlineReader';
import { logger } from '@/utils/logger';

export interface PollerDeps {
  /** 拉取自选股行情（可注入 Mock 以便测试） */
  fetchQuotes?: (symbols: Symbol[]) => Promise<Quote[]>;
  /** 获取自选列表（可注入以便测试） */
  getSymbols?: () => Promise<Symbol[]>;
  /** 异动规则集 */
  rules?: AlertRule[];
  /** 新增事件回调（用于弹本地通知 / 红点） */
  notify?: (events: AlertEvent[]) => void;
  /** 轮询间隔(ms)，默认 15000 */
  intervalMs?: number;
  /** 加载标的日K（指标/突破规则用）；默认本地库，测试可注入 */
  fetchCandles?: (symbols: Symbol[]) => Promise<Map<string, Candle[]>>;
}

/** 默认：优先本地日K；单标的失败跳过 */
async function defaultFetchCandles(symbols: Symbol[]): Promise<Map<string, Candle[]>> {
  const map = new Map<string, Candle[]>();
  for (const s of symbols) {
    try {
      const cs = await getCandlesLocal(s, 'day', 'none');
      if (cs && cs.length > 0) map.set(`${s.code}.${s.exchange}`, cs);
    } catch {
      // 跳过
    }
  }
  return map;
}

/**
 * 纯函数：对当前行情快照跑异动规则，返回「相对已记录历史」真正新增的事件。
 * - `knownEvents` 为已落盘/已知事件（用 symbolKey+ruleId+时间窗去重由 alertHistory 负责），
 *   这里只负责「这次快照触发了哪些规则」，并剔除与 `alreadyKnown` 完全重复的项。
 * - `candleMap`：key=`code.exchange` 的日K，供 breakout/maCross/rsiZone 使用。
 */
export function evaluateWatchlist(
  quotes: Quote[],
  symbols: Symbol[],
  rules: AlertRule[],
  knownKeys: Set<string>,
  candleMap?: Map<string, Candle[]>,
): AlertEvent[] {
  const byKey = new Map(symbols.map((s) => [`${s.code}.${s.exchange}`, s]));
  const inputs = quotes
    .filter((q) => byKey.has(`${q.symbol.code}.${q.symbol.exchange}`))
    .map((q) => {
      const s = byKey.get(`${q.symbol.code}.${q.symbol.exchange}`)!;
      const key = `${s.code}.${s.exchange}`;
      return { symbol: s, quote: q, candles: candleMap?.get(key) };
    });
  const triggered = detectAlerts(inputs, rules);
  return triggered.filter((e) => !knownKeys.has(dedupeKey(e)));
}

export class WatchlistPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private deps: {
    fetchQuotes: NonNullable<PollerDeps['fetchQuotes']>;
    getSymbols: NonNullable<PollerDeps['getSymbols']>;
    rules: AlertRule[];
    notify: NonNullable<PollerDeps['notify']>;
    intervalMs: number;
    fetchCandles: NonNullable<PollerDeps['fetchCandles']>;
  };

  constructor(deps: PollerDeps = {}) {
    this.deps = {
      fetchQuotes: deps.fetchQuotes ?? ((s) => marketData.getQuotes(s)),
      getSymbols: deps.getSymbols ?? getWatchlist,
      rules: deps.rules ?? DEFAULT_ALERT_RULES,
      notify: deps.notify ?? (() => {}),
      intervalMs: deps.intervalMs ?? 15000,
      fetchCandles: deps.fetchCandles ?? defaultFetchCandles,
    };
  }

  /** 立即跑一次检测（不依赖定时器），返回本次新增事件数 */
  async tick(): Promise<number> {
    const symbols = await this.deps.getSymbols();
    if (symbols.length === 0) return 0;
    const quotes = await this.deps.fetchQuotes(symbols);
    const known = new Set((await getAlertHistory()).map(dedupeKey));
    // 每次 tick 重新读取用户自定义规则（支持运行时增删）
    const rules = this.deps.rules === DEFAULT_ALERT_RULES
      ? await getAllAlertRules()
      : this.deps.rules;

    // 指标/突破规则需要 K 线：按需加载（仅当存在启用的此类规则）
    let candleMap: Map<string, Candle[]> | null = null;
    const needCandles = rules.some((r) => r.enabled !== false && ruleNeedsCandles(r));
    if (needCandles) {
      candleMap = await this.deps.fetchCandles(symbols);
    }

    const events = evaluateWatchlist(quotes, symbols, rules, known, candleMap ?? undefined);
    if (events.length > 0) {
      await recordAlerts(events);
      const fresh: typeof events = [];
      for (const e of events) {
        const key = `${e.symbol.code}.${e.symbol.exchange}`;
        if (await shouldSkipNotify(e.ruleId, key)) continue;
        fresh.push(e);
        await markNotified(e.ruleId, key);
      }
      if (fresh.length > 0) this.deps.notify(fresh);
    }
    return events.length;
  }

  private wantRun = false;

  /** 启动轮询 */
  start(): void {
    this.wantRun = true;
    if (this.timer) return;
    this.tickSafe('启动');
  }

  /** tick 的安全包装：失败记日志并指数退避后重排 */
  private tickSafe(phase: string): void {
    this.tick()
      .then(() => recordBackoffSuccess('watchlist').catch(() => undefined))
      .catch((e) => {
        logger.error('WatchlistPoller', `异动检测失败（${phase}）`, { message: String(e?.message ?? e) });
        void recordBackoffFailure('watchlist').catch(() => undefined);
      })
      .finally(() => {
        this.reschedule();
      });
  }

  /** 按退避状态重排下一次 interval */
  private reschedule(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.wantRun) return;
    void getBackoff('watchlist')
      .then((ms) => {
        if (!this.wantRun) return;
        this.deps = { ...this.deps, intervalMs: ms };
        this.timer = setInterval(() => this.tickSafe('轮询'), ms);
      })
      .catch(() => {
        if (this.wantRun) {
          this.timer = setInterval(() => this.tickSafe('轮询'), this.deps.intervalMs);
        }
      });
  }

  /** 停止轮询 */
  stop(): void {
    this.wantRun = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get running(): boolean {
    return this.wantRun;
  }

  /** 运行时更新通知回调（App 启动后注入 AlertCenter）。 */
  setNotifier(fn: PollerDeps['notify']): void {
    this.deps = { ...this.deps, notify: fn ?? (() => {}) };
  }
}

/** 便捷单例：业务层在 App 启动处 start()，切后台 stop()。 */
export const watchlistPoller = new WatchlistPoller();
