/**
 * 自选股仓储（客户端本地持久化）。
 *
 * 本 App 没有后端，自选股等用户数据都保存在客户端存储里。
 * 这里封装 CRUD，业务层只依赖本仓储，不直接碰 storage / db。
 *
 * 持久化已迁入本地 SQLite 库（src/db/UserStore，真机）；jest / 未接入原生环境
 * 由 UserStore 自动回落 AsyncStorage，本仓储与业务层代码均无需区分。
 *
 * 包含两块能力：
 *  - 扁平自选列表（get/add/remove/set）
 *  - 分组管理（createGroup/addToGroup/removeFromGroup/listGroups/renameGroup/deleteGroup）
 *
 * 所有"分组变更"的纯逻辑放在 `groupOps` 命名空间下，便于单测；
 * 异步持久化部分只做"读→纯函数变更→写回"。
 */
import { userStore } from '@/data/db/UserStore';
import { toFullCode, sanitizeSymbol } from '@/domain';
import type { IndexTag, Symbol } from '@/data/api';
import { resolveDynamicGroups } from './dynamicGroups';

/**
 * 领域类型由 UserStore 持有（持久化与类型同处一处，避免循环依赖），
 * 这里原样转出，业务层 import 路径不变。
 */
import type {
  WatchlistGroup,
  WatchlistGroupsState,
  WatchlistGroupKind,
  WatchlistDynamicRule,
} from '@/data/db/UserStore';
export type {
  WatchlistGroup,
  WatchlistGroupsState,
  WatchlistGroupKind,
  WatchlistDynamicRule,
};
export { isDynamicGroup, GROUP_KIND_LABEL } from './dynamicGroups';
/** 兼容调用方从本模块取 Symbol 类型的写法 */
export type { Symbol } from '@/data/api';

export async function getWatchlist(): Promise<Symbol[]> {
  const saved = await userStore.getWatchlist();
  // 数据库驱动：未写入过返回空数组，由页面负责空态引导，不再给内置示例
  if (!saved || saved.length === 0) return [];
  // 清洗历史脏代码（sh603986 / hk03986 等），有变化则落库
  const cleaned = saved.map(sanitizeSymbol);
  const dirty = cleaned.some(
    (s, i) => s.code !== saved[i]!.code || s.exchange !== saved[i]!.exchange,
  );
  if (dirty) {
    await userStore.setWatchlist(cleaned);
    return cleaned;
  }
  return saved;
}

export async function addToWatchlist(symbol: Symbol): Promise<Symbol[]> {
  const clean = sanitizeSymbol(symbol);
  const list = await getWatchlist();
  const exists = list.some(
    (s) => s.code === clean.code && s.exchange === clean.exchange,
  );
  if (exists) return list;
  const next = [...list, clean];
  await userStore.setWatchlist(next);
  return next;
}

export async function removeFromWatchlist(symbol: Symbol): Promise<Symbol[]> {
  const list = await getWatchlist();
  const next = list.filter(
    (s) => !(s.code === symbol.code && s.exchange === symbol.exchange),
  );
  await userStore.setWatchlist(next);
  return next;
}

export async function setWatchlist(list: Symbol[]): Promise<void> {
  await userStore.setWatchlist(list);
}

/* ----------------------------- 分组管理 ----------------------------- */

/** 标的身份键（与 simulation/calc 的 symbolKey 保持一致：code.exchange） */
export function symbolKey(symbol: Symbol): string {
  return `${symbol.code}.${symbol.exchange}`;
}

/** 默认分组（首次启动给出"我的自选"兜底） */
export const DEFAULT_GROUPS: WatchlistGroup[] = [
  { id: 'default', name: '我的自选', symbols: [] },
];

/** 纯函数分组操作集合：不触碰存储，返回新对象（不修改入参） */
export const groupOps = {
  /** 新建分组，已存在同名则忽略返回原数组 */
  create(
    state: WatchlistGroupsState,
    name: string,
    id?: string,
    kind: WatchlistGroupKind = 'static',
    rule: WatchlistDynamicRule | null = null,
  ): WatchlistGroupsState {
    const gid = id?.trim() || name.trim();
    if (!gid || state.groups.some((g) => g.id === gid)) return state;
    return {
      groups: [...state.groups, { id: gid, name: name.trim(), symbols: [], kind, rule }],
    };
  },

  /** 重命名分组（按 id） */
  rename(
    state: WatchlistGroupsState,
    id: string,
    name: string,
  ): WatchlistGroupsState {
    return {
      groups: state.groups.map((g) =>
        g.id === id ? { ...g, name: name.trim() || g.name } : g,
      ),
    };
  },

  /** 删除分组（含组内标的一并丢弃） */
  remove(state: WatchlistGroupsState, id: string): WatchlistGroupsState {
    return { groups: state.groups.filter((g) => g.id !== id) };
  },

  /** 把标的加入某分组；组内按 symbolKey 去重 */
  addToGroup(
    state: WatchlistGroupsState,
    groupId: string,
    symbol: Symbol,
  ): WatchlistGroupsState {
    const key = symbolKey(symbol);
    return {
      groups: state.groups.map((g) => {
        if (g.id !== groupId) return g;
        if (g.symbols.some((s) => symbolKey(s) === key)) return g;
        return { ...g, symbols: [...g.symbols, symbol] };
      }),
    };
  },

  /** 从某分组移除标的（不影响其它分组） */
  removeFromGroup(
    state: WatchlistGroupsState,
    groupId: string,
    symbol: Symbol,
  ): WatchlistGroupsState {
    const key = symbolKey(symbol);
    return {
      groups: state.groups.map((g) =>
        g.id === groupId
          ? { ...g, symbols: g.symbols.filter((s) => symbolKey(s) !== key) }
          : g,
      ),
    };
  },

  /** 查询标的所在的所有分组 id */
  groupsOf(state: WatchlistGroupsState, symbol: Symbol): string[] {
    const key = symbolKey(symbol);
    return state.groups
      .filter((g) => g.symbols.some((s) => symbolKey(s) === key))
      .map((g) => g.id);
  },
};

/* --------------------------- 异步持久化封装 --------------------------- */

async function loadGroups(): Promise<WatchlistGroupsState> {
  const saved = await userStore.getGroups();
  return saved ?? { groups: DEFAULT_GROUPS };
}

async function saveGroups(state: WatchlistGroupsState): Promise<WatchlistGroupsState> {
  await userStore.saveGroups(state);
  return state;
}

export async function getGroups(quotes?: import('@/data/api').Quote[]): Promise<WatchlistGroup[]> {
  const state = await loadGroups();
  const flat = await getWatchlist();
  let q = quotes ?? null;
  if (!q && state.groups.some((g) => g.kind === 'condition')) {
    try {
      const { marketData } = await import('@/data/api');
      q = flat.length > 0 ? await marketData.getQuotes(flat) : [];
    } catch {
      q = null;
    }
  }
  return resolveDynamicGroups(state.groups, { watchlist: flat, quotes: q });
}

export async function createGroup(
  name: string,
  id?: string,
  kind: WatchlistGroupKind = 'static',
  rule: WatchlistDynamicRule | null = null,
): Promise<WatchlistGroup[]> {
  // 未指定 id 时生成唯一 id，避免同名动态组互相顶掉
  const autoId =
    id?.trim() ||
    `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const next = groupOps.create(await loadGroups(), name, autoId, kind, rule);
  await saveGroups(next);
  const flat = await getWatchlist();
  return resolveDynamicGroups(next.groups, { watchlist: flat });
}

export async function renameGroup(id: string, name: string): Promise<WatchlistGroup[]> {
  const next = groupOps.rename(await loadGroups(), id, name);
  return (await saveGroups(next)).groups;
}

export async function deleteGroup(id: string): Promise<WatchlistGroup[]> {
  const next = groupOps.remove(await loadGroups(), id);
  return (await saveGroups(next)).groups;
}

export async function addToGroup(
  groupId: string,
  symbol: Symbol,
): Promise<WatchlistGroup[]> {
  const next = groupOps.addToGroup(await loadGroups(), groupId, symbol);
  return (await saveGroups(next)).groups;
}

export async function removeFromGroup(
  groupId: string,
  symbol: Symbol,
): Promise<WatchlistGroup[]> {
  const next = groupOps.removeFromGroup(await loadGroups(), groupId, symbol);
  return (await saveGroups(next)).groups;
}

export async function groupsOfSymbol(symbol: Symbol): Promise<string[]> {
  return groupOps.groupsOf(await loadGroups(), symbol);
}

/* ------------------------- 指数/板块名称回填 ------------------------- */

/** 尝试覆盖的各板块目录（industry/cn_concept/region/tszs），单项失败不影响其它 */
const INDEX_CATALOG_TAGS: IndexTag[] = ['industry', 'cn_concept', 'region', 'tszs'];

/** 拉取目录并建立 fullCode -> name 映射 */
async function buildIndexNameMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  // 懒加载：仓储在 jest 中广泛使用，避免顶层引入整张 api 模块图
  const { marketData } = await import('@/data/api');
  await Promise.all(
    INDEX_CATALOG_TAGS.map(async (tag) => {
      try {
        const list = await marketData.listIndices(tag);
        for (const it of list) {
          if (!it.name) continue;
          const full = toFullCode(it.symbol);
          if (!map.has(full)) map.set(full, it.name);
        }
      } catch {
        // 忽略单个目录失败
      }
    }),
  );
  return map;
}

/** 用目录名字补齐缺失 name 的标的；无缺失或未命中时保持原引用不变 */
function fillMissingNames(list: Symbol[], map: Map<string, string>): Symbol[] {
  const next = list.map((s) => {
    if (s.name) return s;
    const name = map.get(toFullCode(s));
    return name ? { ...s, name } : s;
  });
  return next.every((s, i) => s === list[i]) ? list : next;
}

/** 板块/指数走 listIndices 目录回填，不走个股 search */
function isIndexTagLike(s: Symbol): boolean {
  return s.exchange === 'TI' || (s.exchange === 'SH' && /^000/.test(s.code));
}

/**
 * 读取「自选 + 分组」并补齐此前缺失的指数/板块名字（旧数据），必要时落库。
 * 页面加载用本函数替代 getWatchlist/getGroups 分开读：
 *  - 全部有名字：仅一次本地读取，不发网络请求；
 *  - 存在缺失：拉板块目录回填并持久化，返回可直接渲染的数据。
 */
export async function loadWatchlistWithBackfill(): Promise<{
  flat: Symbol[];
  groups: WatchlistGroup[];
}> {
  const flat = await getWatchlist();
  const rawGroups = (await userStore.getGroups())?.groups ?? DEFAULT_GROUPS;
  // 动态组 symbols 在此解析；名字回填只针对静态组与扁平自选
  const groups = await resolveDynamicGroups(rawGroups, { watchlist: flat });
  const needBackfill =
    flat.some((s) => !s.name) ||
    groups.some((g) => g.symbols.some((s) => !s.name));
  if (!needBackfill) return { flat, groups };

  const map = await buildIndexNameMap();
  // 个股缺名字时按 code 搜索回填（板块目录覆盖不到的 A/港/美股）
  const missingStocks = [
    ...new Map(
      [...flat, ...groups.flatMap((g) => g.symbols)]
        .filter((s) => !s.name && !isIndexTagLike(s))
        .map((s) => [toFullCode(s), s] as const),
    ).values(),
  ];
  if (missingStocks.length > 0) {
    const { marketData } = await import('@/data/api');
    await Promise.all(
      missingStocks.slice(0, 30).map(async (s) => {
        // 多关键词：纯 code、code.EX、hk/sz/sh 前缀（港股 03986 搜索命中率更高）
        const keywords = [
          s.code,
          toFullCode(s),
          s.exchange === 'HK' ? `hk${s.code}` : `${s.exchange.toLowerCase()}${s.code}`,
        ];
        for (const kw of keywords) {
          try {
            const hits = await marketData.search({ keyword: kw, limit: 8 });
            const hit =
              hits.find((h) => h.symbol.code === s.code && h.symbol.exchange === s.exchange) ??
              hits.find((h) => h.symbol.code === s.code) ??
              hits.find((h) => h.name && h.symbol.exchange === s.exchange);
            if (hit?.name) {
              map.set(toFullCode(s), hit.name);
              break;
            }
          } catch {
            // 继续下一个关键词
          }
        }
      }),
    );
  }
  const newFlat = fillMissingNames(flat, map);
  const newGroups = groups.map((g) => {
    const symbols = fillMissingNames(g.symbols, map);
    return symbols === g.symbols ? g : { ...g, symbols };
  });

  if (newFlat !== flat) await userStore.setWatchlist(newFlat);
  // 只回写静态组的 name（动态组不落库）
  const staticGroups = newGroups.filter((g) => (g.kind ?? 'static') === 'static');
  if (staticGroups.some((g, i) => g !== groups.filter((x) => (x.kind ?? 'static') === 'static')[i])) {
    await userStore.saveGroups({
      groups: rawGroups.map((g) => {
        const n = newGroups.find((x) => x.id === g.id);
        return n && (g.kind ?? 'static') === 'static' ? n : g;
      }),
    });
  }
  return { flat: newFlat, groups: newGroups };
}
