import { groupOps, DEFAULT_GROUPS } from '@/data/repositories/WatchlistRepository';
import {
  resolveConditionGroup,
  resolveDynamicGroups,
  isDynamicGroup,
} from '@/data/repositories/dynamicGroups';
import type { WatchlistGroup } from '@/data/db/UserStore';
import type { Quote, Symbol } from '@/data/api';

function sym(code: string, exchange: 'SH' | 'SZ' = 'SH', name = code): Symbol {
  return { code, exchange, name };
}

function quote(code: string, last: number, prev = last, exchange: 'SH' | 'SZ' = 'SH'): Quote {
  return {
    symbol: sym(code, exchange),
    last,
    prevClose: prev,
    open: prev,
    high: Math.max(last, prev),
    low: Math.min(last, prev),
    volume: 1000,
    amount: last * 1000,
  };
}

describe('groupOps.create 支持动态分组', () => {
  it('默认 static', () => {
    const next = groupOps.create({ groups: [] }, '我的');
    expect(next.groups[0].kind).toBe('static');
    expect(next.groups[0].symbols).toEqual([]);
  });

  it('创建 scan 动态组', () => {
    const next = groupOps.create({ groups: DEFAULT_GROUPS }, '今日扫描', 'dyn_scan', 'scan', {});
    const g = next.groups.find((x) => x.id === 'dyn_scan');
    expect(g?.kind).toBe('scan');
    expect(isDynamicGroup(g!)).toBe(true);
  });
});

describe('resolveConditionGroup', () => {
  const universe = [sym('600000'), sym('000001', 'SZ'), sym('600519')];

  it('按价格区间过滤', async () => {
    const quotes = [quote('600000', 8), quote('000001', 15, 15, 'SZ'), quote('600519', 1800)];
    const out = await resolveConditionGroup({ priceMin: 10, priceMax: 100 }, universe, quotes);
    expect(out.map((s) => s.code)).toEqual(['000001']);
  });

  it('按涨跌幅过滤', async () => {
    const quotes = [quote('600000', 10.5, 10), quote('000001', 9, 10, 'SZ')];
    const out = await resolveConditionGroup({ changePctMin: 3 }, universe, quotes);
    expect(out.map((s) => s.code)).toEqual(['600000']);
  });

  it('无行情的标的跳过', async () => {
    const out = await resolveConditionGroup({ priceMin: 1 }, universe, []);
    expect(out).toEqual([]);
  });
});

describe('resolveDynamicGroups', () => {
  it('static 原样返回', async () => {
    const groups: WatchlistGroup[] = [
      { id: 'a', name: 'A', symbols: [sym('600000')], kind: 'static' },
    ];
    const out = await resolveDynamicGroups(groups, { watchlist: [] });
    expect(out[0].symbols).toHaveLength(1);
  });

  it('condition 用 watchlist+quotes 解析', async () => {
    const groups: WatchlistGroup[] = [
      {
        id: 'cheap',
        name: '低价',
        symbols: [],
        kind: 'condition',
        rule: { universe: 'watchlist', priceMax: 10 },
      },
    ];
    const out = await resolveDynamicGroups(groups, {
      watchlist: [sym('600000'), sym('600519')],
      quotes: [quote('600000', 8), quote('600519', 1800)],
    });
    expect(out[0].symbols.map((s) => s.code)).toEqual(['600000']);
  });
});
