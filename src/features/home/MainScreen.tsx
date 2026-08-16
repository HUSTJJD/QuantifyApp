/**
 * 主页面：信号专区（首页高亮买卖信号）+ 市场概览（指数）+ 自选股列表。
 * 作为 App 启动后的首屏，聚合个人量化信号、行情概要，并导航到个股详情/量化页。
 * 支持亮/暗主题（useAppTheme）。
 */
import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { marketData } from '@/api';
import { useQuotes } from '@/hooks/useMarketData';
import { useSignals } from '@/hooks/useSignals';
import { toFullCode, displaySymbol } from '@/domain';
import type { Symbol, Quote } from '@/api';
import { spacing, fontSize, radius } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { IndexBar } from './IndexBar';
import type { TradeSignal } from '@/quant/signals';

/** 默认指数标的（A股 + 港股通代表） */
const INDICES: Symbol[] = [
  { code: '000001', exchange: 'SH', name: '上证指数' },
  { code: '399001', exchange: 'SZ', name: '深证成指' },
  { code: '899050', exchange: 'BJ', name: '北证50' },
];

const WATCH: Symbol[] = [
  { code: '600519', exchange: 'SH', name: '贵州茅台' },
  { code: '000858', exchange: 'SZ', name: '五粮液' },
  { code: '300750', exchange: 'SZ', name: '宁德时代' },
  { code: '00700', exchange: 'HK', name: '腾讯控股' },
  { code: '03690', exchange: 'HK', name: '美团-W' },
];

export function MainScreen({
  onOpen,
  onWatchlist,
  onSignals,
  onSim,
}: {
  onOpen: (s: Symbol) => void;
  onWatchlist: () => void;
  onSignals: () => void;
  onSim: () => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const indexQuotes = useQuotes(INDICES, 'index');
  const watchQuotes = useQuotes(WATCH);
  const { buys, sells } = useSignals();
  const sourceLabel = marketData.activeSourceId;
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([indexQuotes.reload(), watchQuotes.reload()]);
    } finally {
      setRefreshing(false);
    }
  }, [indexQuotes, watchQuotes]);

  const signalByKey = new Map<string, TradeSignal>();
  for (const s of [...buys, ...sells]) signalByKey.set(s.symbolKey, s);

  const styles = makeStyles(colors);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
      }
    >
      <View style={styles.topBar}>
        <Text style={styles.appTitle}>仙</Text>
        <View style={styles.sourceBadge}>
          <Text style={styles.sourceText}>源: {sourceLabel}</Text>
        </View>
      </View>

      {/* 信号专区：首页高亮个人量化买卖信号 */}
      <TouchableOpacity style={styles.signalZone} onPress={onSignals}>
        <View style={styles.signalZoneHead}>
          <Text style={styles.signalZoneTitle}>我的信号</Text>
          <Text style={styles.signalZoneMore}>查看全部 ›</Text>
        </View>
        <View style={styles.signalZoneBody}>
          <View style={styles.signalStat}>
            <Text style={[styles.signalStatNum, { color: colors.up }]}>{buys.length}</Text>
            <Text style={styles.signalStatLabel}>买入</Text>
          </View>
          <View style={styles.signalDivider} />
          <View style={styles.signalStat}>
            <Text style={[styles.signalStatNum, { color: colors.down }]}>{sells.length}</Text>
            <Text style={styles.signalStatLabel}>卖出</Text>
          </View>
          <View style={styles.signalDivider} />
          <View style={styles.signalPreview}>
            {[...buys, ...sells].slice(0, 3).map((s) => (
              <Text key={s.symbolKey} style={styles.signalPreviewItem} numberOfLines={1}>
                <Text style={{ color: s.side === 'buy' ? colors.up : colors.down }}>{s.side === 'buy' ? '▲' : '▼'}</Text>
                {' '}
                {s.symbolKey}
              </Text>
            ))}
            {buys.length + sells.length === 0 && (
              <Text style={styles.signalPreviewEmpty}>交易时段自动推送信号</Text>
            )}
          </View>
        </View>
      </TouchableOpacity>

      <IndexBar quotes={indexQuotes.data} loading={indexQuotes.loading} />

      {/* 模拟盘入口 */}
      <TouchableOpacity style={styles.simZone} onPress={onSim}>
        <View style={styles.simZoneText}>
          <Text style={styles.simZoneTitle}>模拟盘</Text>
          <Text style={styles.simZoneSub}>虚拟资金练习 · 实时盈亏</Text>
        </View>
        <Text style={styles.signalZoneMore}>进入 ›</Text>
      </TouchableOpacity>

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>自选股</Text>
        <View style={styles.sectionActions}>
          <TouchableOpacity onPress={onWatchlist}>
            <Text style={styles.refresh}>管理</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { indexQuotes.reload(); watchQuotes.reload(); }}>
            <Text style={styles.refresh}>刷新</Text>
          </TouchableOpacity>
        </View>
      </View>

      {watchQuotes.error && <Text style={styles.errText}>行情加载失败：{watchQuotes.error}</Text>}

      <FlatList
        data={watchQuotes.data ?? []}
        keyExtractor={(q) => toFullCode(q.symbol)}
        scrollEnabled={false}
        renderItem={({ item }) => <WatchRow item={item} signal={signalByKey.get(toFullCode(item.symbol))} onPress={() => onOpen(item.symbol)} colors={colors} />}
        ListEmptyComponent={
          watchQuotes.loading ? <Text style={styles.hint}>加载中…</Text> : undefined
        }
      />
    </ScrollView>
  );
}

/** 自选股行（含信号徽标）。顶层组件避免渲染期重建。 */
function WatchRow({ item, signal, onPress, colors }: { item: Quote; signal?: TradeSignal; onPress: () => void; colors: ReturnType<typeof useAppTheme>['colors'] }): React.JSX.Element {
  const chg = item.last - item.prevClose;
  const pct = item.prevClose ? (chg / item.prevClose) * 100 : 0;
  const up = chg >= 0;
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <View style={styles.nameCol}>
        <Text style={styles.name}>{displaySymbol(item.symbol, item.symbol.name)}</Text>
        {signal && signal.side !== 'hold' && (
          <View style={[styles.tag, { backgroundColor: signal.side === 'buy' ? colors.up : colors.down }]}>
            <Text style={styles.tagText}>{signal.side === 'buy' ? '买' : '卖'}</Text>
          </View>
        )}
      </View>
      <Text style={styles.price}>{item.last > 0 ? item.last.toFixed(2) : '--'}</Text>
      <Text style={[styles.chg, { color: up ? colors.up : colors.down }]}>
        {up ? '+' : ''}
        {pct.toFixed(2)}%
      </Text>
    </TouchableOpacity>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.md },
    topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
    appTitle: { color: colors.text, fontSize: fontSize.xl, fontWeight: '800' },
    sourceBadge: { backgroundColor: colors.surfaceAlt, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
    sourceText: { color: colors.textSecondary, fontSize: fontSize.xs },

    signalZone: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    signalZoneHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    signalZoneTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
    signalZoneMore: { color: colors.primary, fontSize: fontSize.sm },
    simZone: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md, borderWidth: 1, borderColor: colors.border },
    simZoneText: { flexDirection: 'column' },
    simZoneTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
    simZoneSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    signalZoneBody: { flexDirection: 'row', alignItems: 'center' },
    signalStat: { alignItems: 'center', width: 56 },
    signalStatNum: { fontSize: fontSize.xl, fontWeight: '800' },
    signalStatLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    signalDivider: { width: 1, height: 36, backgroundColor: colors.border, marginHorizontal: spacing.md },
    signalPreview: { flex: 1, paddingLeft: spacing.sm },
    signalPreviewItem: { color: colors.text, fontSize: fontSize.sm, lineHeight: 20 },
    signalPreviewEmpty: { color: colors.textSecondary, fontSize: fontSize.sm },

    sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.sm },
    sectionTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
    sectionActions: { flexDirection: 'row', gap: spacing.md },
    refresh: { color: colors.primary, fontSize: fontSize.sm },
    errText: { color: colors.down, fontSize: fontSize.sm, marginBottom: spacing.sm },
    hint: { color: colors.textSecondary, fontSize: fontSize.sm },
    nameCol: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    name: { color: colors.text, fontSize: fontSize.md },
    tag: { marginLeft: spacing.sm, borderRadius: radius.sm, paddingHorizontal: 5, paddingVertical: 1 },
    tagText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '700' },
    price: { color: colors.text, fontSize: fontSize.md, width: 90, textAlign: 'right' },
    chg: { width: 80, textAlign: 'right', fontSize: fontSize.md },
  });
}
