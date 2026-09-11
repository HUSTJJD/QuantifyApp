/** 行业映射缓存：板块成分 → 代码行业 */
import { marketData } from '@/data/api';
import { toFullCode } from '@/domain';

const cache = new Map<string, string>();
let loadedAt = 0;
const TTL = 24 * 3600_000;

export async function getIndustryOf(code: string, exchange: string): Promise<string> {
  const key = `${code}.${exchange}`;
  const now = Date.now();
  if (cache.size > 0 && now - loadedAt < TTL) {
    return cache.get(key) || '未分类';
  }
  try {
    const boards = await marketData.listIndices('industry');
    cache.clear();
    // 只拉前 30 个板块成分，控制成本
    for (const b of boards.slice(0, 30)) {
      try {
        const cons = await marketData.getIndexConstituents(b.symbol);
        for (const c of cons) {
          const ck = toFullCode(c.symbol);
          if (!cache.has(ck)) cache.set(ck, b.name);
        }
      } catch {
        // skip board
      }
    }
    loadedAt = Date.now();
    return cache.get(key) || '未分类';
  } catch {
    return '未分类';
  }
}

export function peekIndustryOf(code: string, exchange: string): string {
  return cache.get(`${code}.${exchange}`) || '未分类';
}
