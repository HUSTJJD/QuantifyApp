/**
 * resolvePool —— 选股范围串联测试。
 * watchlist → 自选分组合并去重；scan → 最近快照命中，过期/空池回落自选。
 */
import type { Symbol } from '@/data/api';
import type { StrategyProfile } from '@/quant/profile';

jest.mock('@/data/api', () => ({
  marketData: { getQuotes: jest.fn(async () => []), getKline: jest.fn(async () => []) },
}));

jest.mock('@/data/QuoteFeed', () => ({
  quoteFeed: {
    subscribe: jest.fn(),
    subscribeListener: jest.fn(() => () => undefined),
  },
}));

jest.mock('@/data/repositories/WatchlistRepository', () => ({
  getGroups: jest.fn(),
}));

jest.mock('@/simulation', () => ({
  createAccountRepo: jest.fn(() => ({
    get: jest.fn(async () => ({ initialized: false, cash: 0, positions: [] })),
    submit: jest.fn(async () => ({ result: { ok: false } })),
  })),
}));

import { resolvePool } from '@/quant/runtime';
import { getGroups } from '@/data/repositories/WatchlistRepository';
import { quantStore, resetQuantStore } from '@/data/db/QuantStore';

const mockGetGroups = getGroups as jest.MockedFunction<typeof getGroups>;

function profileOf(universe: 'watchlist' | 'scan'): StrategyProfile {
  return {
    id: 't',
    name: 't',
    note: '',
    enabled: true,
    autoTrade: false,
    legs: [{ templateId: 'trend_confirm', enabled: true, weight: 1, params: {} }],
    combineMode: 'and',
    selection: { universe, priceMax: 0, minTurnoverWan: 0 },
    exit: { takeProfitPct: 0, stopLossPct: 0, trailingPct: 0 },
    trade: { session: 'any', period: 'day', positionRatio: 1 / 3, maxPositions: 1 },
    createdAt: 0,
    updatedAt: 0,
  };
}

function sym(code: string, exchange: Symbol['exchange'] = 'SH'): Symbol {
  return { code, exchange };
}

describe('resolvePool', () => {
  beforeEach(() => {
    resetQuantStore();
    mockGetGroups.mockReset();
  });

  it('watchlist：合并分组并按 code.exchange 去重', async () => {
    mockGetGroups.mockResolvedValue([
      { id: 'g1', name: 'A', symbols: [sym('600000'), sym('000001', 'SZ')] },
      { id: 'g2', name: 'B', symbols: [sym('600000')] },
    ] as any);
    const pool = await resolvePool(profileOf('watchlist'));
    expect(pool.map((s) => `${s.code}.${s.exchange}`)).toEqual(['600000.SH', '000001.SZ']);
  });

  it('scan + 新鲜快照：返回快照命中', async () => {
    mockGetGroups.mockResolvedValue([{ id: 'g1', name: 'A', symbols: [sym('999999')] }] as any);
    const store = quantStore();
    const id = await store.saveScanSnapshot(
      { criteria: '{}', total: 10, hitCount: 2, durationMs: 1, createdAt: Date.now() },
      [
        { code: '600519', exchange: 'SH', name: '茅台', reasons: 'x', lastClose: 1, changePct: null, metrics: '{}' },
        { code: '000001', exchange: 'SZ', name: '平安', reasons: 'y', lastClose: 1, changePct: null, metrics: '{}' },
      ],
    );
    expect(id).toBeGreaterThan(0);
    const pool = await resolvePool(profileOf('scan'));
    expect(pool.map((s) => `${s.code}.${s.exchange}`).sort()).toEqual(['000001.SZ', '600519.SH']);
  });

  it('scan + 过期快照（>24h）：回落自选', async () => {
    mockGetGroups.mockResolvedValue([{ id: 'g1', name: 'A', symbols: [sym('111111')] }] as any);
    const store = quantStore();
    await store.saveScanSnapshot(
      { criteria: '{}', total: 1, hitCount: 1, durationMs: 1, createdAt: Date.now() - 25 * 3600_000 },
      [{ code: '600519', exchange: 'SH', name: '茅台', reasons: '', lastClose: 1, changePct: null, metrics: '{}' }],
    );
    const pool = await resolvePool(profileOf('scan'));
    expect(pool.map((s) => `${s.code}.${s.exchange}`)).toEqual(['111111.SH']);
  });

  it('scan + 无快照：回落自选', async () => {
    mockGetGroups.mockResolvedValue([{ id: 'g1', name: 'A', symbols: [sym('222222')] }] as any);
    const pool = await resolvePool(profileOf('scan'));
    expect(pool.map((s) => `${s.code}.${s.exchange}`)).toEqual(['222222.SH']);
  });
});
