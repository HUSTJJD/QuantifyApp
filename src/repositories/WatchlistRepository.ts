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
import { userStore } from '@/db/UserStore';
import { toFullCode } from '@/domain';
import type { IndexTag, Symbol } from '@/api';

/**
 * 领域类型由 UserStore 持有（持久化与类型同处一处，避免循环依赖），
 * 这里原样转出，业务层 import 路径不变。
 */
import type { WatchlistGroup, WatchlistGroupsState } from '@/db/UserStore';
export type { WatchlistGroup, WatchlistGroupsState };
/** 兼容调用方从本模块取 Symbol 类型的写法 */
export type { Symbol } from '@/api';

export async function getWatchlist(): Promise<Symbol[]> {
  const saved = await userStore.getWatchlist();
  // 数据库驱动：未写入过返回空数组，由页面负责空态引导，不再给内置示例
  return saved ?? [];
}

export async function addToWatchlist(symbol: Symbol): Promise<Symbol[]> {
  const list = await getWatchlist();
  const exists = list.some(
    (s) => s.code === symbol.code && s.exchange === symbol.exchange,
  );
  if (exists) return list;
  const next = [...list, symbol];
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
  ): WatchlistGroupsState {
    const gid = id?.trim() || name.trim();
    if (!gid || state.groups.some((g) => g.id === gid)) return state;
    return {
      groups: [...state.groups, { id: gid, name: name.trim(), symbols: [] }],
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

export async function getGroups(): Promise<WatchlistGroup[]> {
  const state = await loadGroups();
  return state.groups;
}

export async function createGroup(name: string, id?: string): Promise<WatchlistGroup[]> {
  const next = groupOps.create(await loadGroups(), name, id);
  return (await saveGroups(next)).groups;
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
  const { marketData } = await import('@/api');
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
  const groups = await getGroups();
  const needBackfill =
    flat.some((s) => !s.name) || groups.some((g) => g.symbols.some((s) => !s.name));
  if (!needBackfill) return { flat, groups };

  const map = await buildIndexNameMap();
  const newFlat = fillMissingNames(flat, map);
  const newGroups = groups.map((g) => {
    const symbols = fillMissingNames(g.symbols, map);
    return symbols === g.symbols ? g : { ...g, symbols };
  });

  if (newFlat !== flat) await userStore.setWatchlist(newFlat);
  if (newGroups.some((g, i) => g !== groups[i])) {
    await userStore.saveGroups({ groups: newGroups });
  }
  return { flat: newFlat, groups: newGroups };
}
