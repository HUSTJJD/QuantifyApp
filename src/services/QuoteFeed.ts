/**
 * QuoteFeed —— 行情推送服务（轮询模拟「推送」）。
 *
 * 设计要点：
 *  - 应用级单例，常驻。组件通过 subscribe(symbols) 声明要订阅的标的；
 *  - 仅在交易时段内自动轮询（默认 5s），非交易时段停拉，保留收盘快照；
 *  - App 进入后台时暂停轮询（回到前台会强制刷一次最新快照）；
 *  - 拉到的新行情合并进内存热表 + 行情缓存，并逐个通知订阅者（表现即「推送」）；
 *    通知会带上本次拉取到的 Quote[] 快照，下游监听（信号/策略引擎）直接复用，
 *    避免每个监听者再各自发一批行情请求放大 QPS；
 *  - 行情刷新后驱动信号引擎对订阅标的重算买卖信号（见 onQuote 钩子）。
 * 若未来接入 sdk 的真·长连接推送，只需替换内部 fetch 实现，订阅者 API 不变。
 */
import { AppState } from 'react-native';
import type { Quote, Symbol } from '@/api';
import { marketData } from '@/api';
import { isTradingNow } from '@/utils/trading';

type Listener = (symbols: Symbol[], quotes: Quote[]) => void;

const POLL_MS = 5000;

class QuoteFeed {
  private subscribers = new Set<Listener>();
  private subscribed = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private appStateSub: { remove: () => void } | null = null;

  /** 最近一次轮询拿到的行情快照（供下游直接复用，避免重复请求）。 */
  private lastSnapshot: Quote[] = [];

  /** 注册全局行情回调（如驱动信号重算）。 */
  public onQuote: ((symbols: Symbol[], quotes: Quote[]) => void) | null = null;

  /** 订阅一组标的（增量合并，去重）。 */
  subscribe(symbols: Symbol[]): void {
    for (const s of symbols) this.subscribed.add(symKey(s));
    this.ensureRunning();
  }

  /** 取当前订阅的标的数量（调试用）。 */
  subscribedCount(): number {
    return this.subscribed.size;
  }

  /**
   * 读取本地内存快照（零网络请求）：返回最近一次轮询中命中的指定标的行情。
   * 快照未完整覆盖请求标的（空快照 / 缺标的，如停牌）时返回 null，
   * 调用方据此回退到正常请求，保证不缺数据。
   */
  snapshotFor(symbols: Symbol[]): Quote[] | null {
    if (symbols.length === 0) return [];
    if (this.lastSnapshot.length === 0) return null;
    const byKey = new Map<string, Quote>();
    for (const q of this.lastSnapshot) byKey.set(`${q.symbol.exchange}.${q.symbol.code}`, q);
    const out: Quote[] = [];
    for (const s of symbols) {
      const q = byKey.get(symKey(s));
      if (!q) return null;
      out.push(q);
    }
    return out;
  }

  /** 手动触发一次刷新（如切回前台）。force=true 时跳过交易时段/后台门控，确保拿到最新快照。 */
  async refreshNow(): Promise<void> {
    await this.poll(true);
  }

  private ensureRunning(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), POLL_MS);
    // 立即跑一次（强制），避免冷启动等待一个间隔，也确保非交易时段首屏也能拿到收盘快照
    this.poll(true);
    // 切回前台时强制刷新一次（避免跨日停留时一直显示旧缓存）
    if (!this.appStateSub) {
      this.appStateSub = AppState.addEventListener('change', (next) => {
        if (next === 'active') this.refreshNow().catch(() => undefined);
      });
    }
  }

  private async poll(force = false): Promise<void> {
    // 后台不轮询（切回前台时由 AppState 监听强制刷新一次）
    if (!force && AppState.currentState !== 'active') return;
    if (!force && !isTradingNow()) {
      // 非交易时段（非强制）：不打扰，不更新行情；但保持服务存活以便复市自动恢复
      return;
    }
    if (this.running) return;
    this.running = true;
    try {
      const syms = Array.from(this.subscribed).map(parseKey);
      if (syms.length === 0) return;
      const quotes = await marketData.getQuotes(syms);
      this.lastSnapshot = quotes ?? [];
      this.subscribers.forEach((fn) => fn(syms, this.lastSnapshot));
      if (this.onQuote) this.onQuote(syms, this.lastSnapshot);
    } catch {
      // 单次拉取失败不中断轮询，下次重试
    } finally {
      this.running = false;
    }
  }

  subscribeListener(fn: Listener): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }
}

function symKey(s: Symbol): string {
  return `${s.exchange}.${s.code}`;
}
function parseKey(k: string): Symbol {
  const [exchange, code] = k.split('.');
  return { exchange: exchange as Symbol['exchange'], code };
}

export const quoteFeed = new QuoteFeed();
