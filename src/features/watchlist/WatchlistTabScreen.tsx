/**
 * 自选股 Tab（数据库驱动重设计 + mobile-surface-v1 密度升级）。
 *
 * - 单一 FlashList（去掉 ScrollView 嵌套 FlatList）
 * - 行内 MiniDaySparkline + 信号 Tag
 * - 右滑删除（gesture-handler Swipeable）
 * - 分组顶区 GroupSummaryStrip
 * - 骨架屏 / 引导型空态
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useQuotes } from '@/hooks/useMarketData';
import { useSignals } from '@/hooks/useSignals';
import {
  loadWatchlistWithBackfill,
  isDynamicGroup,
  removeFromWatchlist,
} from '@/data/repositories/WatchlistRepository';
import { userStore } from '@/data/db/UserStore';
import type { WatchlistGroup } from '@/data/repositories/WatchlistRepository';
import { toFullCode, displaySymbol } from '@/domain';
import type { Symbol, Quote } from '@/data/api';
import { spacing, fontSize, radius, fontWeight, layout } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { GroupTabs } from './GroupTabs';
import { CreateGroupSheet } from './CreateGroupSheet';
import { GroupSummaryStrip } from './GroupSummaryStrip';
import { SortToggle, type SortMode } from './SortToggle';
import type { TradeSignal } from '@/quant/signals';
import { Card, PriceText, ChangePct, Tag, SkeletonRows, MiniDaySparkline } from '@/components';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';

const ALL_ID = '__all__';

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
  const [showCreate, setShowCreate] = useState(false);

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

  useFocusEffect(
    useCallback(() => {
      loadMeta().catch(() => setReady(true));
    }, [loadMeta]),
  );

  const extraGroups = useMemo(
    () =>
      groups.filter((g) => {
        if (g.id === 'default') return false;
        if ((g.kind ?? 'static') !== 'static') return true;
        return g.symbols.length > 0;
      }),
    [groups],
  );
  const segments: WatchlistGroup[] = useMemo(() => {
    const all: WatchlistGroup = { id: ALL_ID, name: '自选', symbols: flat };
    return extraGroups.length > 0 ? [all, ...extraGroups] : [all];
  }, [flat, extraGroups]);

  const activeSeg = segments.find((s) => s.id === activeId) ?? segments[0];
  const watchSymbols = useMemo(() => activeSeg?.symbols ?? [], [activeSeg]);
  const watchQuotes = useQuotes(watchSymbols, 'stock', focused);
  const { buys, sells } = useSignals();

  useEffect(() => {
    if (!activeSeg) return;
    if (activeId !== ALL_ID && !segments.some((s) => s.id === activeId)) {
      setActiveId(ALL_ID);
    }
  }, [segments, activeId, activeSeg]);

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

  const nameByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of watchSymbols) {
      if (s.name) map.set(toFullCode(s), s.name);
    }
    return map;
  }, [watchSymbols]);

  useEffect(() => {
    const data = watchQuotes.data;
    if (!data?.length) return;
    let cancelled = false;
    (async () => {
      try {
        const saved = (await userStore.getWatchlist()) ?? [];
        const byKey = new Map(saved.map((s) => [toFullCode(s), s]));
        let dirty = false;
        for (const q of data) {
          if (!q.symbol.name) continue;
          const k = toFullCode(q.symbol);
          const cur = byKey.get(k);
          if (cur && !cur.name) {
            byKey.set(k, { ...cur, name: q.symbol.name });
            dirty = true;
          }
        }
        if (dirty && !cancelled) {
          await userStore.setWatchlist([...byKey.values()]);
          loadMeta().catch(() => undefined);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [watchQuotes.data, loadMeta]);

  const quotes = sortQuotes(
    (watchQuotes.data ?? []).map((q) => {
      const stored = q.symbol.name ? undefined : nameByKey.get(toFullCode(q.symbol));
      return stored ? { ...q, symbol: { ...q.symbol, name: stored } } : q;
    }),
    sortMode,
  );

  const summary = useMemo(() => {
    let up = 0;
    let down = 0;
    for (const q of quotes) {
      const p = pctOf(q);
      if (p > 0) up += 1;
      else if (p < 0) down += 1;
    }
    const sigs = quotes.filter((q) => {
      const s = signalByKey.get(toFullCode(q.symbol));
      return s && s.side !== 'hold';
    }).length;
    return { count: quotes.length || watchSymbols.length, upCount: up, downCount: down, signalCount: sigs };
  }, [quotes, watchSymbols.length, signalByKey]);

  const onDeleteRow = useCallback(
    async (symbol: Symbol) => {
      try {
        await removeFromWatchlist(symbol);
        await loadMeta();
      } catch {
        Alert.alert('删除失败', '请稍后重试');
      }
    },
    [loadMeta],
  );

  const isEmpty = ready && watchSymbols.length === 0 && !watchQuotes.loading;
  const emptyDynamic =
    activeSeg && isDynamicGroup(activeSeg) && activeSeg.symbols.length === 0;
  const emptyHint =
    activeSeg?.kind === 'scan'
      ? '暂无扫描命中：到「策略」页跑一轮扫描，结果会自动挂到这里'
      : activeSeg?.kind === 'strategy'
        ? '暂无该策略的买卖信号：策略启用并产生信号后会自动出现'
        : activeSeg?.kind === 'condition'
          ? '暂无符合条件的标的：放宽价格/涨跌幅，或先添加自选'
          : null;
  const styles = makeStyles(colors);

  const header = (
    <View>
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

      <GroupTabs
        groups={segments}
        activeId={activeSeg?.id ?? ALL_ID}
        onSelect={setActiveId}
        onCreate={() => setShowCreate(true)}
      />

      {ready && watchSymbols.length > 0 && (
        <GroupSummaryStrip summary={summary} />
      )}

      {quotes.length > 0 && (
        <View style={styles.toolRow}>
          <SortToggle mode={sortMode} onChange={setSortMode} />
        </View>
      )}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <CreateGroupSheet
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(gid) => {
          if (gid) setActiveId(gid);
          loadMeta().catch(() => undefined);
        }}
      />

      {watchQuotes.error && (
        <Text style={styles.errText}>行情加载失败：{watchQuotes.error}</Text>
      )}

      <FlashList
        data={quotes}
        keyExtractor={(q) => toFullCode(q.symbol)}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={header}
        ListEmptyComponent={
          watchQuotes.loading && !ready ? (
            <SkeletonRows rows={5} style={{ marginTop: spacing.md }} />
          ) : watchQuotes.loading ? (
            <SkeletonRows rows={3} style={{ marginTop: spacing.md }} />
          ) : emptyDynamic ? (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                {activeSeg?.name}（{activeSeg?.symbols.length}）
              </Text>
              <Text style={styles.emptyHint}>{emptyHint ?? '暂无标的，下拉可刷新'}</Text>
            </Card>
          ) : isEmpty && activeId === ALL_ID ? (
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
        renderItem={({ item }) => (
          <WatchRow
            item={item}
            signal={signalByKey.get(toFullCode(item.symbol))}
            onPress={() => onOpen(item.symbol)}
            onDelete={() => onDeleteRow(item.symbol)}
            colors={colors}
          />
        )}
      />
    </View>
  );
}

function WatchRow({
  item,
  signal,
  onPress,
  onDelete,
  colors,
}: {
  item: Quote;
  signal?: TradeSignal;
  onPress: () => void;
  onDelete: () => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
}): React.JSX.Element {
  const chg = item.last - item.prevClose;
  const pct = item.prevClose ? (chg / item.prevClose) * 100 : 0;
  const styles = makeStyles(colors);

  const renderRightActions = () => (
    <TouchableOpacity style={styles.swipeDel} onPress={onDelete} activeOpacity={0.85}>
      <Text style={styles.swipeDelText}>删除</Text>
    </TouchableOpacity>
  );

  return (
    <Swipeable
      renderRightActions={renderRightActions}
      overshootRight={false}
      rightThreshold={40}
    >
      <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.75}>
        <View style={styles.nameCol}>
          <Text style={styles.name} numberOfLines={1}>
            {displaySymbol(item.symbol, item.symbol.name)}
          </Text>
          {signal && signal.side !== 'hold' && (
            <Tag text={signal.side === 'buy' ? '买' : '卖'} variant={signal.side === 'buy' ? 'buy' : 'sell'} />
          )}
        </View>
        <MiniDaySparkline quote={item} width={52} height={26} />
        <PriceText value={item.last > 0 ? item.last : null} style={styles.price} />
        <ChangePct pct={pct} style={styles.chg} />
      </TouchableOpacity>
    </Swipeable>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
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

    toolRow: { marginTop: spacing.xs, marginBottom: spacing.sm },
    errText: { color: colors.down, fontSize: fontSize.sm, marginTop: spacing.sm, paddingHorizontal: spacing.md },
    hint: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      textAlign: 'center',
      paddingVertical: spacing.lg,
    },

    emptyCard: { marginTop: spacing.lg, alignItems: 'center', paddingVertical: spacing.xl },
    emptyTitle: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold as any,
      marginTop: spacing.sm,
    },
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

    nameCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: layout.rowMinHeight,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    name: { color: colors.text, fontSize: fontSize.md, flexShrink: 1 },
    price: { width: 78, textAlign: 'right' },
    chg: { width: 72, textAlign: 'right' },
    swipeDel: {
      width: 72,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.down,
    },
    swipeDelText: { color: '#fff', fontWeight: '600', fontSize: fontSize.md },
  });
}
