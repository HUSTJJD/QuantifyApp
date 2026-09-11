import { reduceNotify, reduceMarkRead } from '@/features/watchlist/alertCenter';
import type { AlertEvent } from '@/features/watchlist/alerts';

const E = (i: number): AlertEvent => ({
  ruleId: `r${i}`,
  type: 'pct',
  symbol: { code: '600519', exchange: 'SH', name: '茅台' },
  value: i,
  message: `异动${i}`,
  time: new Date(2024, 0, 1 + i).getTime(),
});

describe('alertCenter reduceNotify / reduceMarkRead', () => {
  it('空事件返回原 state（不修改）', () => {
    const s = { unread: 0, events: [] };
    expect(reduceNotify(s, [])).toBe(s);
  });

  it('notify 累加未读并保持传入顺序（最新在前由调用方保证）', () => {
    // 调用方传入 [E(2), E(1)] 表示 E(2) 最新，则首位为 E(2)
    const s = reduceNotify({ unread: 0, events: [] }, [E(2), E(1)]);
    expect(s.unread).toBe(2);
    expect(s.events[0]).toStrictEqual(E(2));
    expect(s.events).toHaveLength(2);
  });

  it('不修改入参（纯函数）', () => {
    const s = { unread: 0, events: [E(0)] };
    const before = JSON.stringify(s);
    reduceNotify(s, [E(9)]);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('裁剪到最近 50 条', () => {
    const many = Array.from({ length: 60 }, (_, i) => E(i));
    const s = reduceNotify({ unread: 0, events: [] }, many);
    expect(s.events).toHaveLength(50);
    expect(s.unread).toBe(60);
  });

  it('markRead 清零未读（无未读返回原对象）', () => {
    const s = { unread: 0, events: [E(0)] };
    expect(reduceMarkRead(s)).toBe(s);
    const s2 = reduceMarkRead({ unread: 3, events: [E(0)] });
    expect(s2.unread).toBe(0);
  });
});
