import {
  parseTimestamp,
  toNormalizedNews,
  toNormalizedAnnouncement,
  aggregateNews,
  dedupeNews,
  sortByTimeDesc,
  buildNewsFeed,
  NewsItem,
  AnnouncementItem,
} from '@/features/stock/news';

describe('news 新闻/公告聚合', () => {
  it('parseTimestamp：支持多种格式', () => {
    expect(parseTimestamp('2026-08-24T09:30:00')).toBe(new Date('2026-08-24T09:30:00').getTime());
    expect(parseTimestamp('2026-08-24 09:30:00')).toBe(new Date('2026-08-24T09:30:00').getTime());
    expect(parseTimestamp('2026/08/24')).toBe(new Date('2026-08-24T00:00:00').getTime());
    expect(parseTimestamp('1692857400')).toBe(1692857400 * 1000); // 10 位秒
    expect(parseTimestamp('1692857400000')).toBe(1692857400000); // 13 位 ms
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp('not-a-date')).toBeNull();
  });

  it('toNormalizedNews / toNormalizedAnnouncement：种类与字段映射', () => {
    const n = toNormalizedNews({ title: 'A 上涨', publishTime: '2026-08-24 10:00:00', source: '东方财富', url: 'u1' });
    expect(n.kind).toBe('news');
    expect(n.title).toBe('A 上涨');
    expect(n.source).toBe('东方财富');
    const a = toNormalizedAnnouncement({ title: '半年报', publishDate: '2026-08-23', url: 'u2' });
    expect(a.kind).toBe('announcement');
    expect(a.url).toBe('u2');
  });

  it('dedupeNews：按 kind+title 去重', () => {
    const items = [
      { title: '利好', rawTime: '', timeMs: 1, kind: 'news' as const },
      { title: '利好', rawTime: '', timeMs: 2, kind: 'news' as const },
      { title: '利好', rawTime: '', timeMs: 3, kind: 'announcement' as const },
    ];
    expect(dedupeNews(items).length).toBe(2); // news 去重剩 1，announcement 保留 1
  });

  it('sortByTimeDesc：时间倒序，null 排末尾', () => {
    const items = [
      { title: 'a', rawTime: '', timeMs: 100, kind: 'news' as const },
      { title: 'b', rawTime: '', timeMs: null, kind: 'news' as const },
      { title: 'c', rawTime: '', timeMs: 300, kind: 'news' as const },
    ];
    const sorted = sortByTimeDesc(items);
    expect(sorted.map((x) => x.title)).toEqual(['c', 'a', 'b']);
  });

  it('buildNewsFeed：聚合+去重+排序 一站式', () => {
    const news: NewsItem[] = [
      { title: '盘中拉升', publishTime: '2026-08-24 10:00:00' },
      { title: '盘中拉升', publishTime: '2026-08-24 10:00:00' }, // 重复
      { title: '早盘快讯', publishTime: '2026-08-24 09:00:00' },
    ];
    const ann: AnnouncementItem[] = [{ title: '半年报', publishDate: '2026-08-23' }];
    const feed = buildNewsFeed(news, ann);
    expect(feed.length).toBe(3); // 2 条新闻去重为 1 + 早盘 + 公告
    expect(feed[0].title).toBe('盘中拉升'); // 最新在前
    expect(feed[feed.length - 1].title).toBe('半年报');
  });

  it('aggregateNews：空输入安全', () => {
    expect(aggregateNews()).toEqual([]);
    expect(aggregateNews([])).toEqual([]);
  });
});
