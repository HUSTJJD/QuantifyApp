import { getAppPrefs, setAppPrefs, DEFAULT_PREFS, primeAppPrefs, peekAppPrefs } from '@/settings/appPrefs';
import { setStorage, MemoryStorageAdapter } from '@/data/db/storage';

describe('appPrefs', () => {
  beforeEach(() => {
    setStorage(new MemoryStorageAdapter());
    primeAppPrefs({ ...DEFAULT_PREFS });
  });

  it('无存储时返回默认', async () => {
    const p = await getAppPrefs();
    expect(p.quoteIntervalSec).toBe(5);
    expect(p.defaultInitCash).toBe(100_000);
    expect(p.showHotStocks).toBe(true);
  });

  it('setAppPrefs 合并并夹紧范围', async () => {
    const p = await setAppPrefs({ quoteIntervalSec: 999, defaultPositionRatio: 5, defaultInitCash: 1 });
    expect(p.quoteIntervalSec).toBe(60);
    expect(p.defaultPositionRatio).toBe(1);
    expect(p.defaultInitCash).toBe(10_000);
    const again = await getAppPrefs();
    expect(again.quoteIntervalSec).toBe(60);
  });

  it('peekAppPrefs 在 prime 后同步可读', async () => {
    const p = await setAppPrefs({ quoteIntervalSec: 10 });
    primeAppPrefs(p);
    expect(peekAppPrefs().quoteIntervalSec).toBe(10);
  });

  it('布尔开关可关', async () => {
    const p = await setAppPrefs({ showHotStocks: false, showLimitBoard: false, showFundFlow: false });
    expect(p.showHotStocks).toBe(false);
    expect(p.showLimitBoard).toBe(false);
    expect(p.showFundFlow).toBe(false);
  });

  it('defaultSignalPeriod 非法值回落 day', async () => {
    const p = await setAppPrefs({ defaultSignalPeriod: 'xx' as any });
    expect(p.defaultSignalPeriod).toBe('day');
    const p2 = await setAppPrefs({ defaultSignalPeriod: '15m' });
    expect(p2.defaultSignalPeriod).toBe('15m');
  });
});
