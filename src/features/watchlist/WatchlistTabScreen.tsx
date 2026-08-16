/**
 * 自选股 Tab（数据库驱动重设计）。
 *
 * 布局：顶部一行 = 搜索入口 + 管理入口（无大标题/无数据源小字）；
 * 分组 Tab 仅在确有自定义分组时出现；列表数据完全来自本地库
 * （quantify.db：自选扁平表 + 分组表），无任何内置示例兜底：
 * 空库时展示引导卡（一键搜索添加，添加后回到本页自动刷新）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useQuotes } from '@/hooks/useMarketData';
import { useSignals } from '@/hooks/useSignals';
import { loadWatchlistWithBackfill } from '@/repositories/WatchlistRepository';
import type { WatchlistGroup } from '@/repositories/WatchlistRepository';
import { toFullCode, displaySymbol } from '@/domain';
import type { Symbol, Quote } from '@/api';
import { spacing, fontSize, radius, fontWeight } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { GroupTabs } from './GroupTabs';
import { SortToggle, type SortMode } from './SortToggle';
import type { TradeSignal } from '@/quant/signals';
import { Card, PriceText, ChangePct, Tag } from '@/components';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';

/** 「自选」虚拟分组 id（内容 = 本地库扁平自选表） */
const ALL_ID = '__all__';

/** 对行情列表按排序模式排序 */
function sortQuotes(quotes: Quote[], mode: SortMode): Quote[] {
  const arr = [...quotes];
  switch (mode) {
    case 'pctDesc':
      return arr.sort((a, b) => pctOf(b) - pctOf(a));
    case 'pctAsc':
      return arr.sort((a, b) => pctOf(a) - pctOf(b));
    case 'priceDesc':
      return arr.sort((a, b) => b.last - a.last);
    case 'priceAsc':
      return arr.sort((a, b) => a.last - b.last);
    default:
      return arr;
  }
}
function pctOf(q: Quote): number {
  if (!q.prevClose) return 0;
  return ((q.last - q.prevClose) / q.prevClose) * 100;
}

export function WatchlistTabScreen({
  onOpen,
  onManage,
  onSearch,
}: {
  onOpen: (s: Symbol) => void;
  onManage: () => void;
  onSearch?: () => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [groups, setGroups] = useState<WatchlistGroup[]>([]);
  const [flat, setFlat] = useState<Symbol[]>([]);
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState<string>(ALL_ID);
  const [refreshing, setRefreshing] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('default');

  /** 从数据库重读「自选列表 + 分组」并补齐旧数据缺失的指数/板块名字 */
  const loadMeta = useCallback(async () => {
    try {
      const { groups: gs, flat: wl } = await loadWatchlistWithBackfill();
      setGroups(gs);
      setFlat(wl);
      setActiveId((cur) =>
        cur !== ALL_ID && !gs.some((g) => g.id === cur) ? ALL_ID : cur,
      );
    } finally {
      setReady(true);
    }
  }, []);

  // 每次聚焦本页都重读一次（个股详情加自选后返回即可见，无需手动刷新）
  useFocusEffect(
    useCallback(() => {
      loadMeta().catch(() => setReady(true));
    }, [loadMeta]),
  );

  // 用户自建分组（含标的）才作为独立分段展示；旧的空「默认」分组不重复展示
  const extraGroups = useMemo(
    () => groups.filter((g) => g.id !== 'default' && g.symbols.length > 0),
    [groups],
  );
  const segments: WatchlistGroup[] = useMemo(() => {
    const all: WatchlistGroup = { id: ALL_ID, name: '自选', symbols: flat };
    return extraGroups.length > 0 ? [all, ...extraGroups] : [all];
  }, [flat, extraGroups]);

  const activeSeg = segments.find((s) => s.id === activeId) ?? segments[0];
  const watchSymbols = activeSeg?.symbols ?? [];
  const watchQuotes = useQuotes(watchSymbols, 'stock', focused);
  const { buys, sells } = useSignals();

  useEffect(() => {
    if (!activeSeg || activeSeg.symbols.length > 0) return;
    // 选中分组已无标的时回落「自选」（正常不会发生：空分组不展示）
    if (activeSeg.id !== ALL_ID) setActiveId(ALL_ID);
  }, [activeSeg]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([watchQuotes.reload(), loadMeta()]);
    } finally {
      setRefreshing(false);
    }
  }, [watchQuotes, loadMeta]);

  const signalByKey = useMemo(() => {
    const map = new Map<string, TradeSignal>();
    for (const s of [...buys, ...sells]) map.set(s.symbolKey, s);
    return map;
  }, [buys, sells]);

  // 本地库中的名字优先：行情缓存可能带旧（空）name，指数/板块回填后即时生效
  const nameByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of watchSymbols) {
      if (s.name) map.set(toFullCode(s), s.name);
    }
    return map;
  }, [watchSymbols]);

  const quotes = sortQuotes(
    (watchQuotes.data ?? []).map((q) => {
      const stored = q.symbol.name ? undefined : nameByKey.get(toFullCode(q.symbol));
      return stored ? { ...q, symbol: { ...q.symbol, name: stored } } : q;
    }),
    sortMode,
  );
  const isEmpty = ready && watchSymbols.length === 0 && !watchQuotes.loading;
  const styles = makeStyles(colors);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
      }
    >
      {/* 顶部工具栏：搜索 + 管理（无页面大标题，无数据源角标） */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.searchEntry}
          onPress={() => onSearch?.()}
          activeOpacity={0.7}
        >
          <Icon name={Icons.search} size={2} color="textSecondary" style={styles.searchIcon} />
          <Text style={styles.searchPlaceholder}>搜索股票，加自选</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.manageBtn} onPress={onManage} activeOpacity={0.7}>
          <Text style={styles.manageText}>管理</Text>
        </TouchableOpacity>
      </View>

      {/* 分组 Tab：仅当确有自定义分组时展示 */}
      {segments.length > 1 && (
        <GroupTabs
          groups={segments}
          activeId={activeSeg?.id ?? ALL_ID}
          onSelect={setActiveId}
        />
      )}

      {watchQuotes.error && <Text style={styles.errText}>行情加载失败：{watchQuotes.error}</Text>}

      {quotes.length > 0 && (
        <View style={styles.toolRow}>
          <SortToggle mode={sortMode} onChange={setSortMode} />
        </View>
      )}

      <FlatList
        data={quotes}
        keyExtractor={(q) => toFullCode(q.symbol)}
        scrollEnabled={false}
        renderItem={({ item }) => (
          <WatchRow
            item={item}
            signal={signalByKey.get(toFullCode(item.symbol))}
            onPress={() => onOpen(item.symbol)}
            colors={colors}
          />
        )}
        ListEmptyComponent={
          watchQuotes.loading ? (
            <Text style={styles.hint}>加载中…</Text>
          ) : isEmpty ? (
            <Card style={styles.emptyCard}>
              <Icon name={Icons.starOutline} size="xl" color="textSecondary" />
              <Text style={styles.emptyTitle}>还没有自选股票</Text>
              <Text style={styles.emptyHint}>搜索并添加后自动保存到本地数据库</Text>
              {onSearch && (
                <TouchableOpacity style={styles.emptyBtn} onPress={onSearch} activeOpacity={0.8}>
                  <Icon name={Icons.search} size={2} color="#fff" style={styles.emptyBtnIcon} />
                  <Text style={styles.emptyBtnText}>搜索添加</Text>
                </TouchableOpacity>
              )}
            </Card>
          ) : (
            <Text style={styles.hint}>暂无行情数据，下拉刷新重试</Text>
          )
        }
      />
    </ScrollView>
  );
}

/** 自选股行（含信号徽标）。顶层组件避免渲染期重建。 */
function WatchRow({
  item,
  signal,
  onPress,
  colors,
}: {
  item: Quote;
  signal?: TradeSignal;
  onPress: () => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
}): React.JSX.Element {
  const chg = item.last - item.prevClose;
  const pct = item.prevClose ? (chg / item.prevClose) * 100 : 0;
  const up = chg >= 0;
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <View style={styles.nameCol}>
        <Text style={styles.name} numberOfLines={1}>
          {displaySymbol(item.symbol, item.symbol.name)}
        </Text>
        {signal && signal.side !== 'hold' && (
          <Tag text={signal.side === 'buy' ? '买' : '卖'} variant={signal.side === 'buy' ? 'buy' : 'sell'} />
        )}
      </View>
      <PriceText value={item.last > 0 ? item.last : null} style={styles.price} />
      <ChangePct pct={pct} style={styles.chg} />
    </TouchableOpacity>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.md },
    topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    searchEntry: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      height: 40,
    },
    searchIcon: { marginRight: spacing.sm },
    searchPlaceholder: { color: colors.textSecondary, fontSize: fontSize.md },
    manageBtn: { paddingHorizontal: spacing.sm, height: 40, justifyContent: 'center' },
    manageText: { color: colors.primary, fontSize: fontSize.md },

    toolRow: { marginTop: spacing.sm },
    errText: { color: colors.down, fontSize: fontSize.sm, marginTop: spacing.sm },
    hint: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center', paddingVertical: spacing.lg },

    emptyCard: { marginTop: spacing.lg, alignItems: 'center', paddingVertical: spacing.xl },
    emptyTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold as any, marginTop: spacing.sm },
    emptyHint: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 4 },
    emptyBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      marginTop: spacing.md,
    },
    emptyBtnIcon: { marginRight: spacing.xs },
    emptyBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '600' },

    nameCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    name: { color: colors.text, fontSize: fontSize.md, flexShrink: 1 },
    price: { width: 90, textAlign: 'right' },
    chg: { width: 76, textAlign: 'right' },
  });
}
