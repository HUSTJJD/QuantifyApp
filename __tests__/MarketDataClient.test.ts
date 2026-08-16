/**
 * MarketDataClient（基于 SourceRouter 的新门面）路由冒烟测试。
 *
 * 不联网，用可控 mock 源隔离注册表，验证：
 *   1. getKline(week/month) 路由到 hithsa 并由其在源内聚合成周/月 K（验证 10 年窗口钳制后可正常拉取）；
 *   2. getQuotes 按交易所分源（A 股走 hithsa，港股走 stock-sdk）—— partition 语义；
 *   3. 全部失败抛出聚合错误。
 *
 * 注：原测试面向旧的 resolveOrder / SUPPORT_MATRIX / runWithFallback 架构，随 db 接入重构（改走 SourceRouter）
 * 已失效；这里重写为面向新架构的最小冒烟测试。更完整的路由/兜底/熔断覆盖建议补 SourceRouter.test.ts。
 */
import { MarketDataClient } from '@/api/MarketDataClient';
import { setApiConfig, defaultApiConfig } from '@/api/config';
import type { MarketDataSource } from '@/api/MarketDataSource';
import { DataSourceError } from '@/api/MarketDataSource';
import type { Symbol } from '@/api/types';
import { isIndexSymbol } from '@/domain/symbol';

const A: Symbol = { code: '600519', exchange: 'SH', name: '贵州茅台' };
const HK: Symbol = { code: '00700', exchange: 'HK', name: '腾讯控股' };

/** 构造一个可控 mock 源：仅声明 caps 中的方法，supports 按交易所分源（同真实源） */
function makeSource(
  id: string,
  caps: string[],
  impl: Record<string, (...a: any[]) => unknown>,
): MarketDataSource {
  const s: Record<string, unknown> = {
    id,
    label: id,
    capabilities: new Set(caps),
    async init() {},
    async dispose() {},
    supports(method: string, args: unknown[]) {
      // partition 调用时 args = [[symbol]]，取出其中的 symbol 判断交易所
      if (method === 'getQuotes') {
        const arg = args[0];
        const syms = Array.isArray(arg) ? (arg as Symbol[]) : [arg as Symbol];
        const sym = syms[0];
        if (!sym || !sym.exchange) return true;
        if (id === 'hithsa') return sym.exchange === 'SH' || sym.exchange === 'SZ';
        if (id === 'stock-sdk') return sym.exchange === 'HK';
      }
      return true;
    },
  };
  caps.forEach((m) => (s[m] = impl[m]));
  return s as unknown as MarketDataSource;
}

function buildClient(sources: Record<string, MarketDataSource>): MarketDataClient {
  const factory = (id: string) => {
    const s = sources[id];
    if (!s) throw new Error(`no source ${id}`);
    return s;
  };
  return new MarketDataClient({ sourceFactory: factory });
}

describe('MarketDataClient (SourceRouter) 路由', () => {
  beforeEach(() =>
    setApiConfig({ ...defaultApiConfig, sourceOrder: ['hithsa', 'stock-sdk', 'stock-api', 'fund-api'] }),
  );

  it('getKline(week) 路由到 hithsa 并由其聚合周K', async () => {
    const calls: unknown[] = [];
    const hithsa = makeSource('hithsa', ['getKline'], {
      getKline: async (p: unknown) => {
        calls.push(p);
        return [{ datetime: new Date().toISOString(), open: 1, high: 1, low: 1, close: 1, volume: 1 }];
      },
    });
    const client = buildClient({ hithsa });
    await client.getKline({ symbol: A, period: 'week', count: 10 });
    expect(calls).toHaveLength(1);
    expect((calls[0] as { period: string }).period).toBe('week');
  });

  it('getKline(month) 同样路由到 hithsa', async () => {
    const calls: unknown[] = [];
    const hithsa = makeSource('hithsa', ['getKline'], {
      getKline: async (p: unknown) => {
        calls.push(p);
        return [{ datetime: new Date().toISOString(), open: 1, high: 1, low: 1, close: 1, volume: 1 }];
      },
    });
    const client = buildClient({ hithsa });
    await client.getKline({ symbol: A, period: 'month', count: 10 });
    expect((calls[0] as { period: string }).period).toBe('month');
  });

  it('getQuotes A 股走 hithsa、港股走 stock-sdk（partition 分源，结果按入参顺序）', async () => {
    const hithsaSyms: Symbol[] = [];
    const sdkSyms: Symbol[] = [];
    const hithsa = makeSource('hithsa', ['getQuotes'], {
      getQuotes: async (syms: Symbol[]) => {
        hithsaSyms.push(...syms);
        return syms.map((s) => ({ symbol: s, last: 1 }));
      },
    });
    const sdk = makeSource('stock-sdk', ['getQuotes'], {
      getQuotes: async (syms: Symbol[]) => {
        sdkSyms.push(...syms);
        return syms.map((s) => ({ symbol: s, last: 1 }));
      },
    });
    const client = buildClient({ hithsa, 'stock-sdk': sdk });
    const res = await client.getQuotes([A, HK]);
    expect(res).toHaveLength(2);
    expect(hithsaSyms).toEqual([A]);
    expect(sdkSyms).toEqual([HK]);
  });

  it('全源失败抛出聚合错误', async () => {
    const fail = makeSource('hithsa', ['getKline'], {
      getKline: async () => {
        throw new DataSourceError('x', 'hithsa', 3004);
      },
    });
    const client = buildClient({ hithsa: fail });
    await expect(client.getKline({ symbol: A, period: 'day' })).rejects.toThrow(/all data sources failed/);
  });

  it('所有源都“如实返回空”时按无数据返回 []，不再抛聚合错误（周末/停牌/无接口标的）', async () => {
    const empty1 = makeSource('hithsa', ['getKline'], { getKline: async () => [] });
    const empty2 = makeSource('stock-sdk', ['getKline'], { getKline: async () => [] });
    const client = buildClient({ hithsa: empty1, 'stock-sdk': empty2 });
    await expect(client.getKline({ symbol: A, period: 'day' })).resolves.toEqual([]);
  });

  it('空结果 + 另一源“不支持(3004)”同样按无数据返回 []（不误报故障）', async () => {
    const empty = makeSource('hithsa', ['getKline'], { getKline: async () => [] });
    const unsupported = makeSource('stock-sdk', ['getKline'], {
      getKline: async () => {
        throw new DataSourceError('x', 'stock-sdk', 3004);
      },
    });
    const client = buildClient({ hithsa: empty, 'stock-sdk': unsupported });
    await expect(client.getKline({ symbol: A, period: 'day' })).resolves.toEqual([]);
  });

  it('只要有真实故障（非 3004）仍抛聚合错误，不吞异常', async () => {
    const empty = makeSource('hithsa', ['getKline'], { getKline: async () => [] });
    const broken = makeSource('stock-sdk', ['getKline'], {
      getKline: async () => {
        throw new Error('network timeout');
      },
    });
    const client = buildClient({ hithsa: empty, 'stock-sdk': broken });
    await expect(client.getKline({ symbol: A, period: 'day' })).rejects.toThrow(/all data sources failed/);
  });

  it('partition：所有源返回空且无异常时返回 []（不抛“no result”）', async () => {
    const empty = makeSource('hithsa', ['getQuotes'], { getQuotes: async () => [] });
    const client = buildClient({ hithsa: empty });
    const res = await client.getQuotes([A]);
    expect(res).toEqual([]);
  });

  // ---------------- 个股 vs 指数/板块 代码体系分流 ----------------

  it('getKline：指数/板块标的自动路由到 getIndexKline，个股仍走 getKline', async () => {
    const calls: string[] = [];
    const hithsa = makeSource('hithsa', ['getKline', 'getIndexKline'], {
      getKline: async () => {
        calls.push('getKline');
        return [];
      },
      getIndexKline: async () => {
        calls.push('getIndexKline');
        return [];
      },
    });
    const client = buildClient({ hithsa });
    // 同花顺行业板块指数（.TI）→ 指数端点
    await client.getKline({ symbol: { code: '881101', exchange: 'TI', name: '白色家电' }, period: 'day' });
    // 上证指数（SH 且 000 开头）→ 指数端点
    await client.getKline({ symbol: { code: '000001', exchange: 'SH', name: '上证指数' }, period: 'day' });
    // 深证成指（SZ 且 399 开头）→ 指数端点
    await client.getKline({ symbol: { code: '399001', exchange: 'SZ', name: '深证成指' }, period: 'day' });
    // 北证 50（BJ 且 899 开头）→ 指数端点
    await client.getKline({ symbol: { code: '899050', exchange: 'BJ', name: '北证50' }, period: 'day' });
    // 个股 → 个股端点
    await client.getKline({ symbol: A, period: 'day' });
    expect(calls).toEqual(['getIndexKline', 'getIndexKline', 'getIndexKline', 'getIndexKline', 'getKline']);
  });

  it('getQuotes：混合「个股 + 板块指数」时按类型分源拉取（指数走 getIndexQuotes）', async () => {
    const TI: Symbol = { code: '881101', exchange: 'TI', name: '白色家电' };
    const hithsa = makeSource('hithsa', ['getQuotes', 'getIndexQuotes'], {
      getQuotes: async (syms: unknown) => (syms as Symbol[]).map((s) => ({ symbol: s, last: 1 })),
      getIndexQuotes: async (syms: unknown) => (syms as Symbol[]).map((s) => ({ symbol: s, last: 2 })),
    });
    const client = buildClient({ hithsa });
    const res = await client.getQuotes([A, TI]);
    expect(res).toHaveLength(2);
    // 个股走个股端点
    expect(res.find((q) => q.symbol.code === '600519')?.last).toBe(1);
    // 板块指数走指数端点
    expect(res.find((q) => q.symbol.code === '881101')?.last).toBe(2);
  });
});

describe('isIndexSymbol 个股 vs 指数/板块判别', () => {
  const idx = (code: string, exchange: Symbol['exchange']): Symbol => ({ code, exchange });

  it('板块指数与标准指数都判为指数', () => {
    expect(isIndexSymbol(idx('881101', 'TI'))).toBe(true);
    expect(isIndexSymbol(idx('000001', 'SH'))).toBe(true);
    expect(isIndexSymbol(idx('000300', 'SH'))).toBe(true);
    expect(isIndexSymbol(idx('399001', 'SZ'))).toBe(true);
    expect(isIndexSymbol(idx('899050', 'BJ'))).toBe(true);
  });

  it('个股不误判（含易混代码段）', () => {
    expect(isIndexSymbol(idx('600519', 'SH'))).toBe(false);
    expect(isIndexSymbol(idx('688981', 'SH'))).toBe(false);
    // 深市同号代码是股票：000001.SZ 是平安银行，非上证指数
    expect(isIndexSymbol(idx('000001', 'SZ'))).toBe(false);
    // 创业板股票 300xxx 与深证指数 399xxx 不同段
    expect(isIndexSymbol(idx('300750', 'SZ'))).toBe(false);
    expect(isIndexSymbol(idx('830799', 'BJ'))).toBe(false);
    expect(isIndexSymbol(idx('00700', 'HK'))).toBe(false);
  });
});
