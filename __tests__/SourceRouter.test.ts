/**
 * SourceRouter / coalesce 单元测试（不联网）。
 *
 * 覆盖 P1 架构收敛的「并发同形请求合并」机制：
 *  1. stableStringify：同形参数（key 顺序不同）产出同键、数组保序、嵌套稳定；
 *  2. InflightCoalescer：并发同键共享一次任务、失败共享、settle 后自清理不串扰；
 *  3. SourceRouter：并发同形 invoke / partition 只触发一次底层源调用；
 *     不同参数 / coalesce=false 时各自独立执行（不过度合并）。
 */
import { SourceRouter } from '@/data/api/SourceRouter';
import type { MarketDataSource } from '@/data/api/MarketDataSource';
import { InflightCoalescer, stableStringify } from '@/data/api/coalesce';
import { apiStats } from '@/data/api/ApiStabilityStats';
import type { Quote, Symbol } from '@/data/api/types';

const SH: Symbol = { code: '600519', exchange: 'SH', name: '贵州茅台' };
const SZ: Symbol = { code: '000001', exchange: 'SZ', name: '平安银行' };

function quoteFor(s: Symbol): Quote {
  return {
    symbol: s,
    last: 10,
    prevClose: 9.9,
    open: 9.9,
    high: 10.1,
    low: 9.8,
    volume: 1000,
    amount: 10000,
  };
}

/** 可控 mock 源：仅实现 getQuotes，记录调用次数 */
function makeSrc(id: string, delayMs: number) {
  let calls = 0;
  const s: Record<string, unknown> = {
    id,
    label: id,
    capabilities: new Set<string>(['getQuotes']),
    async init() {},
    async dispose() {},
    supports(): boolean {
      return true;
    },
    async getQuotes(symbols: Symbol[]): Promise<Quote[]> {
      calls += 1;
      if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      return symbols.map(quoteFor);
    },
  };
  return { src: s as unknown as MarketDataSource, callCount: () => calls };
}

function routerFor(src: MarketDataSource, coalesce?: boolean): SourceRouter {
  const factory = (id: string) => (id === src.id ? src : null as unknown as MarketDataSource);
  return new SourceRouter({ factory, order: [src.id], coalesce });
}

describe('stableStringify —— 稳定序列化', () => {
  it('对象 key 顺序不同但同形时产出同键', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('嵌套对象 key 深度排序', () => {
    expect(stableStringify({ x: { b: 1, a: 2 } })).toBe(stableStringify({ x: { a: 2, b: 1 } }));
  });

  it('数组保序（元素顺序不同 = 不同键）', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('undefined 字段剔除后同形同键', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});

describe('InflightCoalescer —— 在途合并', () => {
  it('并发同键共享一次任务，且共享相同结果', async () => {
    const c = new InflightCoalescer();
    let runs = 0;
    const task = () => {
      runs += 1;
      return new Promise<number>((r) => setTimeout(() => r(42), 20));
    };
    const [p1, p2] = [c.run('k', task), c.run('k', task)];
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(runs).toBe(1);
    expect(r1).toBe(42);
    expect(r2).toBe(42);
    expect(c.size).toBe(0);
  });

  it('settle 后自清理：稍后的同键调用重新执行', async () => {
    const c = new InflightCoalescer();
    let runs = 0;
    const task = () => Promise.resolve(runs += 1);
    await c.run('k', task);
    await c.run('k', task);
    expect(runs).toBe(2);
  });

  it('失败也共享（不重复触发），随后可重新执行', async () => {
    const c = new InflightCoalescer();
    let runs = 0;
    const task = () => {
      runs += 1;
      return new Promise<string>((_, rej) => setTimeout(() => rej(new Error('boom')), 10));
    };
    const [p1, p2] = [c.run('k', task), c.run('k', task)];
    await expect(p1).rejects.toThrow('boom');
    await expect(p2).rejects.toThrow('boom');
    expect(runs).toBe(1);
    await c.run('k', task).catch(() => undefined);
    expect(runs).toBe(2);
    expect(c.size).toBe(0);
  });

  it('不同键互不影响', async () => {
    const c = new InflightCoalescer();
    let runs = 0;
    const task = () => new Promise<number>((r) => setTimeout(() => r(runs += 1), 10));
    await Promise.all([c.run('a', task), c.run('b', task)]);
    expect(runs).toBe(2);
  });
});

describe('SourceRouter —— 并发同形请求合并', () => {
  it('并发同参 invoke 只触发一次源调用', async () => {
    const { src, callCount } = makeSrc('mock-a', 30);
    const r = routerFor(src);
    const [a, b] = [
      r.invoke('getQuotes', [[SH, SZ]]),
      r.invoke('getQuotes', [[SH, SZ]]),
    ];
    const [ra, rb] = await Promise.all([a, b]);
    expect(callCount()).toBe(1);
    expect(ra).toHaveLength(2);
    expect(rb).toHaveLength(2);
  });

  it('不同参数不合并（各自独立执行）', async () => {
    const { src, callCount } = makeSrc('mock-b', 30);
    const r = routerFor(src);
    await Promise.all([r.invoke('getQuotes', [[SH]]), r.invoke('getQuotes', [[SZ]])]);
    expect(callCount()).toBe(2);
  });

  it('coalesce=false 时并发同参各自执行', async () => {
    const { src, callCount } = makeSrc('mock-c', 30);
    const r = routerFor(src, false);
    await Promise.all([
      r.invoke('getQuotes', [[SH, SZ]]),
      r.invoke('getQuotes', [[SH, SZ]]),
    ]);
    expect(callCount()).toBe(2);
  });

  it('并发同形 partition 只触发一次源调用，且按各自入参顺序返回', async () => {
    const { src, callCount } = makeSrc('mock-d', 30);
    const r = routerFor(src);
    const key = (s: Symbol) => `${s.exchange}.${s.code}`;
    const [a, b] = [
      r.partition('getQuotes', [SH, SZ], key, (q) => `${q.symbol.exchange}.${q.symbol.code}`, (sub) => [sub]),
      r.partition('getQuotes', [SH, SZ], key, (q) => `${q.symbol.exchange}.${q.symbol.code}`, (sub) => [sub]),
    ];
    const [ra, rb] = await Promise.all([a, b]);
    expect(callCount()).toBe(1);
    expect(ra).toHaveLength(2);
    expect(ra[0].symbol).toBe(SH);
    expect(rb[1].symbol).toBe(SZ);
  });
});

describe('SourceRouter —— 稳定优先排序', () => {
  function twoSrcRouter(stable: boolean) {
    const a = makeSrc('mock-a', 0);
    const b = makeSrc('mock-b', 0);
    const factory = (id: string) =>
      id === 'mock-a' ? a.src : id === 'mock-b' ? b.src : (null as unknown as MarketDataSource);
    const r = new SourceRouter({
      factory,
      order: ['mock-a', 'mock-b'],
      coalesce: false,
      stableRouting: stable,
    });
    return { r, a, b };
  }

  it('有统计时优先选更稳的源（而非固定配置顺序）', async () => {
    const { r } = twoSrcRouter(true);
    const spy = jest.spyOn(apiStats, 'score');
    spy.mockImplementation((s) => (s.id === 'mock-a' ? 30 : 90)); // b 更稳
    const res = await r.invoke('getQuotes', [[SH]]);
    spy.mockRestore();
    expect(res).toHaveLength(1);
    expect(r.lastSourceId).toBe('mock-b');
  });

  it('stableRouting=false 时退化为配置顺序', async () => {
    const { r } = twoSrcRouter(false);
    const spy = jest.spyOn(apiStats, 'score');
    spy.mockImplementation((s) => (s.id === 'mock-a' ? 30 : 90)); // 即便 b 更稳
    const res = await r.invoke('getQuotes', [[SH]]);
    spy.mockRestore();
    expect(res).toHaveLength(1);
    expect(r.lastSourceId).toBe('mock-a'); // 配置顺序在前
  });

  it('冷启动（无统计）保持配置顺序', async () => {
    const { r } = twoSrcRouter(true);
    const spy = jest.spyOn(apiStats, 'getStat');
    spy.mockReturnValue(undefined); // 模拟无统计
    const res = await r.invoke('getQuotes', [[SH]]);
    spy.mockRestore();
    expect(res).toHaveLength(1);
    expect(r.lastSourceId).toBe('mock-a'); // 配置顺序在前
  });
});
