/**
 * UserStore 单测（jest 下走 AsyncStorage 回落路径，真机走 SQLite）。
 *
 * 覆盖：自选/分组/持仓/快照的读写语义，重点是两条容易踩空的约定：
 *  - 从未写入过 → 返回 null（调用方据此给默认自选/默认分组）；
 *  - 写入过空列表 → 返回 []（用户清空自选后不应又被塞回默认自选）。
 */
import { userStore } from '@/db/UserStore';
import { storage, StorageKeys } from '@/db/storage';
import type { Symbol } from '@/api';

const A: Symbol = { code: '600519', exchange: 'SH', name: '贵州茅台' };
const B: Symbol = { code: '000858', exchange: 'SZ', name: '五粮液' };

describe('UserStore 用户数据读写', () => {
  beforeEach(async () => {
    await storage.remove(StorageKeys.WATCHLIST);
    await storage.remove(StorageKeys.WATCHLIST_GROUPS);
    await storage.remove(StorageKeys.PORTFOLIO_HOLDINGS);
    await storage.remove(StorageKeys.PORTFOLIO_SNAPSHOTS);
  });

  it('自选：未写入返回 null；写入后按序返回', async () => {
    expect(await userStore.getWatchlist()).toBeNull();
    await userStore.setWatchlist([A, B]);
    expect(await userStore.getWatchlist()).toEqual([A, B]);
  });

  it('自选：写入空列表后返回 []，不再回落默认自选', async () => {
    await userStore.setWatchlist([]);
    expect(await userStore.getWatchlist()).toEqual([]);
  });

  it('分组：未写入返回 null；save/get 往返保序', async () => {
    expect(await userStore.getGroups()).toBeNull();
    await userStore.saveGroups({
      groups: [
        { id: 'g1', name: '科技', symbols: [A, B] },
        { id: 'g2', name: '消费', symbols: [] },
      ],
    });
    const state = await userStore.getGroups();
    expect(state?.groups.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(state?.groups[0].symbols).toEqual([A, B]);
    expect(state?.groups[1].symbols).toEqual([]);
  });

  it('分组：全量覆盖（保存后旧分组消失）', async () => {
    await userStore.saveGroups({ groups: [{ id: 'g1', name: '科技', symbols: [A] }] });
    await userStore.saveGroups({ groups: [{ id: 'g2', name: '消费', symbols: [] }] });
    const state = await userStore.getGroups();
    expect(state?.groups.map((g) => g.id)).toEqual(['g2']);
  });

  it('持仓：读写往返', async () => {
    expect(await userStore.getHoldings()).toEqual([]);
    await userStore.setHoldings([{ symbol: A, shares: 100, costPrice: 1680.5 }]);
    expect(await userStore.getHoldings()).toEqual([
      { symbol: A, shares: 100, costPrice: 1680.5 },
    ]);
  });

  it('快照：按时间升序，且只保留最近 90 条', async () => {
    for (let i = 1; i <= 95; i += 1) {
      await userStore.addSnapshot({ ts: i, total: i * 100 });
    }
    const snaps = await userStore.getSnapshots();
    expect(snaps).toHaveLength(90);
    expect(snaps[0].ts).toBe(6);
    expect(snaps[snaps.length - 1].ts).toBe(95);
  });
});
