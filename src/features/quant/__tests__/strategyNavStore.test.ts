/**
 * strategyNavStore —— 策略专属模拟盘净值快照：按日覆盖、上限 400、重置清空。
 */
import { setStorage, MemoryStorageAdapter } from '@/data/db/storage';
import {
  getStrategySnapshots,
  addStrategySnapshot,
  resetStrategySnapshots,
} from '../strategyNavStore';

describe('strategyNavStore', () => {
  beforeEach(() => {
    setStorage(new MemoryStorageAdapter());
  });

  it('空账户返回空数组', async () => {
    expect(await getStrategySnapshots('p1')).toEqual([]);
  });

  it('追加快照并按时间升序', async () => {
    const d1 = Date.parse('2026-09-10T10:00:00+08:00');
    const d2 = Date.parse('2026-09-11T10:00:00+08:00');
    await addStrategySnapshot('p1', { ts: d2, total: 102 });
    await addStrategySnapshot('p1', { ts: d1, total: 100 });
    const list = await getStrategySnapshots('p1');
    expect(list.map((s) => s.ts)).toEqual([d1, d2]);
    expect(list.map((s) => s.total)).toEqual([100, 102]);
  });

  it('同日多次只保留最后一次', async () => {
    const day = Date.parse('2026-09-12T10:00:00+08:00');
    await addStrategySnapshot('p1', { ts: day, total: 100 });
    await addStrategySnapshot('p1', { ts: day + 3600_000, total: 110 });
    const list = await getStrategySnapshots('p1');
    expect(list).toHaveLength(1);
    expect(list[0].total).toBe(110);
  });

  it('不同 profileId 相互隔离', async () => {
    await addStrategySnapshot('p1', { ts: 1000, total: 100 });
    await addStrategySnapshot('p2', { ts: 1000, total: 200 });
    expect(await getStrategySnapshots('p1')).toHaveLength(1);
    expect((await getStrategySnapshots('p1'))[0].total).toBe(100);
    expect((await getStrategySnapshots('p2'))[0].total).toBe(200);
  });

  it('reset 清空该策略快照', async () => {
    await addStrategySnapshot('p1', { ts: 1000, total: 100 });
    await resetStrategySnapshots('p1');
    expect(await getStrategySnapshots('p1')).toEqual([]);
  });
});
