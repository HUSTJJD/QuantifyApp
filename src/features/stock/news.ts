/**
 * 新闻 / 公告聚合（纯函数）。
 *
 * 上游行情/资讯接口返回的结构松散（NewsItem / AnnouncementItem），
 * 这里做归一化、去重、按时间排序，并支持合并成统一流，便于 UI 展示。
 * 不依赖任何网络/存储，全部可单测。
 */

import type { NewsItem, AnnouncementItem } from '@/api/types';

// re-export：供消费方（如 __tests__/news.test.ts）从本源引用统一类型
export type { NewsItem, AnnouncementItem } from '@/api/types';

export type NewsKind = 'news' | 'announcement';

export interface NormalizedNews {
  title: string;
  /** 解析后的时间戳（ms），无法解析时为 null */
  timeMs: number | null;
  /** 原始时间字符串 */
  rawTime: string;
  source?: string;
  url?: string;
  kind: NewsKind;
}

/** 解析常见时间格式为 ms：ISO、'YYYY-MM-DD HH:mm:ss'、'YYYY-MM-DD'、纯数字时间戳。返回 null 表示无法解析。 */
export function parseTimestamp(s?: string | null): number | null {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  // 纯数字（秒或毫秒时间戳）
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return n < 1e12 ? n * 1000 : n; // 10 位按秒处理
  }
  // 兼容空格分隔的日期时间（JS Date 不支持 'YYYY-MM-DD HH:mm:ss' 在所有引擎都稳定，统一替换）
  let normalized = t.replace(' ', 'T').replace(/\//g, '-');
  // 纯日期（无时间部分）按「本地零点」解析，避免被当作 UTC 导致时区偏移
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += 'T00:00:00';
  const d = new Date(normalized);
  if (!Number.isNaN(d.getTime())) return d.getTime();
  return null;
}

/** 将 NewsItem 归一化。 */
export function toNormalizedNews(item: NewsItem): NormalizedNews {
  const rawTime = typeof item.publishTime === 'string' ? item.publishTime : '';
  return {
    title: item.title ?? '',
    timeMs: parseTimestamp(item.publishTime),
    rawTime,
    source: typeof item.source === 'string' ? item.source : undefined,
    url: item.url ?? undefined,
    kind: 'news',
  };
}

/** 将 AnnouncementItem 归一化。 */
export function toNormalizedAnnouncement(item: AnnouncementItem): NormalizedNews {
  const rawTime = typeof item.publishDate === 'string' ? item.publishDate : '';
  return {
    title: item.title ?? '',
    timeMs: parseTimestamp(item.publishDate),
    rawTime,
    url: item.url ?? undefined,
    kind: 'announcement',
  };
}

/** 合并新闻与公告为统一流（未去重、未排序）。 */
export function aggregateNews(news: NewsItem[] = [], announcements: AnnouncementItem[] = []): NormalizedNews[] {
  return [...news.map(toNormalizedNews), ...announcements.map(toNormalizedAnnouncement)];
}

/**
 * 去重：按 (title + kind) 归一后去重，保留首次出现。
 * 标题做空白/标点压缩后比较，忽略大小写。
 */
export function dedupeNews(items: NormalizedNews[]): NormalizedNews[] {
  const seen = new Set<string>();
  const out: NormalizedNews[] = [];
  for (const it of items) {
    const key = `${it.kind}::${it.title.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/** 按时间倒序（null 排末尾）。返回新数组。 */
export function sortByTimeDesc(items: NormalizedNews[]): NormalizedNews[] {
  return [...items].sort((a, b) => {
    if (a.timeMs === null && b.timeMs === null) return 0;
    if (a.timeMs === null) return 1;
    if (b.timeMs === null) return -1;
    return b.timeMs - a.timeMs;
  });
}

/** 聚合 + 去重 + 排序 的一站式入口。 */
export function buildNewsFeed(news: NewsItem[] = [], announcements: AnnouncementItem[] = []): NormalizedNews[] {
  return sortByTimeDesc(dedupeNews(aggregateNews(news, announcements)));
}
