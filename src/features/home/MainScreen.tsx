/**
 * 主页面：搜索入口 + 市场概览（指数）+ 行业板块热力图。
 * 作为 App 启动后的首屏，聚合行情概要，并导航到个股详情/量化页。
 * 自选/信号/模拟盘均已迁移至独立底部页签（WatchlistTabScreen / SignalsScreen / Sim）。
 * 支持亮/暗主题（useAppTheme）。UI 已迁移到统一组件库（components/ui）+ Icon。
 */
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useQuotes } from '@/hooks/useMarketData';
import type { Symbol } from '@/api';
import { spacing, fontSize, radius } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { IndexBar } from './IndexBar';
import { SectorBoard } from './SectorBoard';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';

/** 默认指数标的（A股 + 港股通代表） */
const INDICES: Symbol[] = [
  { code: '000001', exchange: 'SH', name: '上证指数' },
  { code: '399001', exchange: 'SZ', name: '深证成指' },
  { code: '899050', exchange: 'BJ', name: '北证50' },
];

export function MainScreen({
  onOpen,
  onSearch,
}: {
  onOpen: (s: Symbol) => void;
  onSearch: () => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const focused = useIsFocused();
  const indexQuotes = useQuotes(INDICES, 'index', focused);
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await indexQuotes.reload();
    } finally {
      setRefreshing(false);
    }
  }, [indexQuotes]);

  const styles = makeStyles(colors);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
      }
    >
      {/* 搜索入口 */}
      <TouchableOpacity style={styles.searchEntry} onPress={onSearch} activeOpacity={0.7}>
        <Icon name={Icons.search} size={2} color="textSecondary" style={styles.searchIcon} />
        <Text style={styles.searchPlaceholder}>搜索股票、指数、基金</Text>
      </TouchableOpacity>

      {/* 市场概览（指数） */}
      <IndexBar quotes={indexQuotes.data} loading={indexQuotes.loading} />

      {/* 行业板块热力图 */}
      <SectorBoard
        tag="industry"
        onPress={(idx) => onOpen({ ...idx.symbol, name: idx.name || idx.symbol.name })}
      />
    </ScrollView>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.md },
    searchEntry: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      height: 40,
      marginBottom: spacing.md,
    },
    searchIcon: { marginRight: spacing.sm },
    searchPlaceholder: { color: colors.textSecondary, fontSize: fontSize.md },
  });
}
