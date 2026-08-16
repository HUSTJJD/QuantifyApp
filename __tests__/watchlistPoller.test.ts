import {
  evaluateWatchlist,
  WatchlistPoller,
} from '@/features/watchlist/poller';
import { dedupeKey, clearAlertHistory } from '@/features/watchlist/alertHistory';
import { DEFAULT_ALERT_RULES } from '@/features/watchlist/alerts';
import { MemoryStorageAdapter, setStorage } from '@/db/storage';
import type { Symbol, Quote } from '@/api';

const SYM: Symbol = { code: '600519', exchange: 'SH', name: '茅台' };
const QUOTE_UP: Quote = {
  symbol: SYM,
  last: 105,
  prevClose: 100,
  open: 100,
  high: 105,
  low: 100,
  volume: 1000,
  amount: 0,
};

describe('evaluateWatchlist', () => {
  it('行情触发涨跌幅阈值时产出事件', () => {
    const events = evaluateWatchlist([QUOTE_UP], [SYM], DEFAULT_ALERT_RULES, new Set());
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe('pct');
  });

  it('已知 dedupeKey 集合内的事件被过滤（不去重重复通知）', () => {
    const known = new Set([dedupeKey(evaluateWatchlist([QUOTE_UP], [SYM], DEFAULT_ALERT_RULES, new Set())[0])]);
    const events = evaluateWatchlist([QUOTE_UP], [SYM], DEFAULT_ALERT_RULES, known);
    expect(events).toHaveLength(0);
  });

  it('自选列表外的标的被忽略', () => {
    const events = evaluateWatchlist([QUOTE_UP], [], DEFAULT_ALERT_RULES, new Set());
    expect(events).toHaveLength(0);
  });
});

describe('WatchlistPoller', () => {
  beforeEach(() => {
    setStorage(new MemoryStorageAdapter());
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('tick 落盘新增事件并通过 notify 回调', async () => {
    const notify = jest.fn();
    const poller = new WatchlistPoller({
      getSymbols: async () => [SYM],
      fetchQuotes: async () => [QUOTE_UP],
      notify,
      intervalMs: 1000,
    });
    const n = await poller.tick();
    expect(n).toBeGreaterThan(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].length).toBe(n);

    // 再次 tick：已落盘，不再重复通知
    const n2 = await poller.tick();
    expect(n2).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('start 触发首检并按时轮询；stop 停止', async () => {
    const notify = jest.fn();
    const poller = new WatchlistPoller({
      getSymbols: async () => [SYM],
      fetchQuotes: async () => [QUOTE_UP],
      notify,
      intervalMs: 5000,
    });
    poller.start();
    expect(poller.running).toBe(true);
    // 首检在 start 内异步触发，推进 0ms 让微任务落定
    await jest.advanceTimersByTimeAsync(0);
    expect(notify).toHaveBeenCalledTimes(1);

    // 推进一个周期：已落盘，无新增
    await jest.advanceTimersByTimeAsync(5000);
    expect(notify).toHaveBeenCalledTimes(1);

    poller.stop();
    expect(poller.running).toBe(false);
  });

  it('空自选列表不报错、不通知', async () => {
    const notify = jest.fn();
    const poller = new WatchlistPoller({
      getSymbols: async () => [],
      fetchQuotes: async () => [],
      notify,
    });
    const n = await poller.tick();
    expect(n).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});
