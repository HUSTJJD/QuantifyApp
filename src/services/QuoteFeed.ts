/**
 * QuoteFeed —— 行情推送服务（轮询模拟「推送」）。
 *
 * 设计要点：
 *  - 应用级单例，常驻。组件通过 subscribe(symbols) 声明要订阅的标的；
 *  - 仅在交易时段内自动轮询（默认 5s），非交易时段停拉，保留收盘快照；
 *  - 拉到的新行情合并进内存热表 + 行情缓存，并逐个通知订阅者（表现即「推送」）；
 *  - 行情刷新后驱动信号引擎对订阅标的重算买卖信号（见 onQuote 钩子）。
 * 若未来接入 sdk 的真·长连接推送，只需替换内部 fetch 实现，订阅者 API 不变。
 */
import type { Symbol } from '@/api';
import { marketData } from '@/api';
import { isTradingNow } from '@/utils/trading';

type Listener = (symbols: Symbol[]) => void;

const POLL_MS = 5000;

class QuoteFeed {
  private subscribers = new Set<Listener>();
  private subscribed = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /** 注册全局行情回调（如驱动信号重算）。 */
  public onQuote: ((symbols: Symbol[]) => void) | null = null;

  /** 订阅一组标的（增量合并，去重）。 */
  subscribe(symbols: Symbol[]): void {
    for (const s of symbols) this.subscribed.add(symKey(s));
    this.ensureRunning();
  }

  /** 取当前订阅的标的数量（调试用）。 */
  subscribedCount(): number {
    return this.subscribed.size;
  }

  /** 手动触发一次刷新（如切回前台）。 */
  async refreshNow(): Promise<void> {
    await this.poll();
  }

  private ensureRunning(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), POLL_MS);
    // 立即跑一次，避免冷启动等待一个间隔
    this.poll();
  }

  private async poll(): Promise<void> {
    if (!isTradingNow()) {
      // 非交易时段不打扰，不更新行情；但保持服务存活以便复市自动恢复
      return;
    }
    if (this.running) return;
    this.running = true;
    try {
      const syms = Array.from(this.subscribed).map(parseKey);
      if (syms.length === 0) return;
      await marketData.getQuotes(syms);
      this.subscribers.forEach((fn) => fn(syms));
      if (this.onQuote) this.onQuote(syms);
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
