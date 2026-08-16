import {
  groupOps,
  symbolKey,
  DEFAULT_GROUPS,
  WatchlistGroupsState,
  Symbol,
} from '@/repositories/WatchlistRepository';
import type { Exchange } from '@/api';

const sym = (code: string, exchange: Exchange): Symbol => ({ code, exchange, name: code });
const A = sym('600519', 'SH');
const B = sym('000858', 'SZ');

function state(): WatchlistGroupsState {
  return { groups: DEFAULT_GROUPS.map((g) => ({ ...g, symbols: [] })) };
}

describe('WatchlistRepository.groupOps 分组管理（纯函数）', () => {
  it('symbolKey：code.exchange', () => {
    expect(symbolKey(A)).toBe('600519.SH');
  });

  it('create：新建分组，已存在同名/同 id 忽略', () => {
    const s1 = groupOps.create(state(), '科技', 'tech');
    expect(s1.groups.length).toBe(2);
    const s2 = groupOps.create(s1, '科技', 'tech'); // 同 id 忽略
    expect(s2.groups.length).toBe(2);
    const s3 = groupOps.create(s2, '科技'); // 默认 id=name=科技，与 tech 不同，新增
    expect(s3.groups.length).toBe(3);
    const s4 = groupOps.create(s3, '   '); // 空名忽略
    expect(s4.groups.length).toBe(3);
  });

  it('rename：按 id 重命名', () => {
    const s = groupOps.create(state(), '旧名', 'g1');
    const r = groupOps.rename(s, 'g1', '新名');
    expect(r.groups.find((g) => g.id === 'g1')?.name).toBe('新名');
  });

  it('remove：删除分组含标的丢弃', () => {
    let s = groupOps.create(state(), '分组', 'g1');
    s = groupOps.addToGroup(s, 'g1', A);
    const r = groupOps.remove(s, 'g1');
    expect(r.groups.find((g) => g.id === 'g1')).toBeUndefined();
    expect(r.groups.length).toBe(1);
  });

  it('addToGroup：加入并按 symbolKey 去重', () => {
    let s = groupOps.create(state(), '分组', 'g1');
    s = groupOps.addToGroup(s, 'g1', A);
    s = groupOps.addToGroup(s, 'g1', A); // 重复忽略
    expect(s.groups.find((g) => g.id === 'g1')?.symbols.length).toBe(1);
    s = groupOps.addToGroup(s, 'g1', B);
    expect(s.groups.find((g) => g.id === 'g1')?.symbols.length).toBe(2);
  });

  it('removeFromGroup：仅移除目标分组标的', () => {
    let s = groupOps.create(state(), 'g1', 'g1');
    s = groupOps.create(s, 'g2', 'g2');
    s = groupOps.addToGroup(s, 'g1', A);
    s = groupOps.addToGroup(s, 'g2', A);
    const r = groupOps.removeFromGroup(s, 'g1', A);
    expect(r.groups.find((g) => g.id === 'g1')?.symbols.length).toBe(0);
    expect(r.groups.find((g) => g.id === 'g2')?.symbols.length).toBe(1);
  });

  it('groupsOf：查询标的所在分组', () => {
    let s = groupOps.create(state(), 'g1', 'g1');
    s = groupOps.create(s, 'g2', 'g2');
    s = groupOps.addToGroup(s, 'g1', A);
    expect(groupOps.groupsOf(s, A).sort()).toEqual(['g1']);
    s = groupOps.addToGroup(s, 'g2', A);
    expect(groupOps.groupsOf(s, A).sort()).toEqual(['g1', 'g2']);
    expect(groupOps.groupsOf(s, B)).toEqual([]);
  });

  it('纯函数不可变：不修改入参', () => {
    const s = groupOps.create(state(), '分组', 'g1');
    const before = s.groups.length;
    groupOps.addToGroup(s, 'g1', A);
    expect(s.groups.length).toBe(before);
    expect(s.groups.find((g) => g.id === 'g1')?.symbols.length).toBe(0);
  });
});
