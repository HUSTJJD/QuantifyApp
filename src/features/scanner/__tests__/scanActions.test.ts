import type { Symbol } from '@/data/api';
import type { ScanHit } from '@/quant/scanner';
import { hitKey, hitsToSymbols, addHitsToWatchlist, saveScanSnapshot } from '../scanActions';
import { quantStore, resetQuantStore } from '@/data/db/QuantStore';

function makeHit(code: string, exchange: Symbol['exchange'] = 'SH', name = code): ScanHit {
  return {
    symbol: { code, exchange, name },
    name,
    reasons: ['MACD 金叉'],
    lastClose: 10,
    changePct: 1.2,
    metrics: {},
  };
}

describe('scanActions', () => {
  it('hitKey 组合 code.exchange', () => {
    expect(hitKey(makeHit('600000'))).toBe('600000.SH');
    expect(hitKey(makeHit('000001', 'SZ'))).toBe('000001.SZ');
  });

  it('hitsToSymbols 按 code.exchange 去重，保留首次出现', () => {
    const hits = [makeHit('600000'), makeHit('600000'), makeHit('000001', 'SZ')];
    const syms = hitsToSymbols(hits);
    expect(syms).toHaveLength(2);
    expect(syms.map((s) => `${s.code}.${s.exchange}`)).toEqual([
      '600000.SH',
      '000001.SZ',
    ]);
  });

  it('addHitsToWatchlist 对去重后每只调用一次 add，返回去重数量', async () => {
    const calls: Symbol[] = [];
    const add = jest.fn(async (s: Symbol) => {
      calls.push(s);
      return [];
    });
    const hits = [makeHit('600000'), makeHit('600000'), makeHit('000001', 'SZ')];
    const n = await addHitsToWatchlist(hits, add);
    expect(n).toBe(2);
    expect(add).toHaveBeenCalledTimes(2);
    expect(calls.map((s) => `${s.code}.${s.exchange}`)).toEqual([
      '600000.SH',
      '000001.SZ',
    ]);
  });

  it('addHitsToWatchlist 空结果返回 0 且不调用 add', async () => {
    const add = jest.fn(async () => [] as Symbol[]);
    expect(await addHitsToWatchlist([], add)).toBe(0);
    expect(add).not.toHaveBeenCalled();
  });

  describe('saveScanSnapshot', () => {
    beforeEach(() => resetQuantStore());

    it('持久化快照与命中明细，可回读', async () => {
      const hits = [makeHit('600000'), makeHit('000001', 'SZ')];
      const id = await saveScanSnapshot({ macdGoldenCross: true }, hits, 5000, 1234);
      expect(id).toBeGreaterThan(0);

      const store = quantStore();
      const snapshots = await store.listScanSnapshots();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].hitCount).toBe(2);
      expect(snapshots[0].total).toBe(5000);
      expect(JSON.parse(snapshots[0].criteria)).toEqual({ macdGoldenCross: true });

      const hitRows = await store.listScanHits(id);
      expect(hitRows).toHaveLength(2);
      expect(hitRows[0].code).toBe('600000');
      expect(hitRows[0].reasons).toContain('MACD');
    });

    it('空命中也可落库', async () => {
      const id = await saveScanSnapshot({}, [], 100, 50);
      const store = quantStore();
      const hitRows = await store.listScanHits(id);
      expect(hitRows).toHaveLength(0);
    });
  });
});
