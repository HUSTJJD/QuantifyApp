/**
 * useWatchlist —— 自选股分组 Hook。
 *
 * 封装分组状态管理：加载分组、切换当前分组、新建/重命名/删除分组。
 * 业务组件只管 UI 展示，不直接碰仓储。
 */
import { useState, useEffect, useCallback } from 'react';
import {
  getGroups,
  createGroup,
  renameGroup,
  deleteGroup,
  addToGroup,
  removeFromGroup,
  type WatchlistGroup,
} from '@/repositories/WatchlistRepository';

export function useWatchlistGroups() {
  const [groups, setGroups] = useState<WatchlistGroup[]>([]);
  const [activeId, setActiveId] = useState<string>('default');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const gs = await getGroups();
    setGroups(gs);
    if (gs.length > 0 && !gs.some((g) => g.id === activeId)) {
      setActiveId(gs[0].id);
    }
    setLoading(false);
  }, [activeId]);

  useEffect(() => {
    load();
  }, []);

  const activeGroup = groups.find((g) => g.id === activeId) ?? groups[0] ?? null;

  const handleCreate = useCallback(async (name: string) => {
    const next = await createGroup(name);
    setGroups(next);
    const created = next.find((g) => g.name === name);
    if (created) setActiveId(created.id);
  }, []);

  const handleRename = useCallback(async (id: string, name: string) => {
    const next = await renameGroup(id, name);
    setGroups(next);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    const next = await deleteGroup(id);
    setGroups(next);
    if (activeId === id && next.length > 0) {
      setActiveId(next[0].id);
    }
  }, [activeId]);

  const handleAdd = useCallback(async (groupId: string, symbol: Parameters<typeof addToGroup>[1]) => {
    const next = await addToGroup(groupId, symbol);
    setGroups(next);
  }, []);

  const handleRemove = useCallback(async (groupId: string, symbol: Parameters<typeof removeFromGroup>[1]) => {
    const next = await removeFromGroup(groupId, symbol);
    setGroups(next);
  }, []);

  return {
    groups,
    activeId,
    activeGroup,
    loading,
    setActiveId,
    reload: load,
    createGroup: handleCreate,
    renameGroup: handleRename,
    deleteGroup: handleDelete,
    addToGroup: handleAdd,
    removeFromGroup: handleRemove,
  };
}
