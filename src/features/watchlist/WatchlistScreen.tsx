/**
 * 自选股列表页（示例 feature）。演示如何消费统一 API 与数据源切换，
 * 并把自选股持久化到客户端本地存储（WatchlistRepository）。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { marketData } from '@/api';
import { useQuotes } from '@/hooks/useMarketData';
import { toFullCode, displaySymbol } from '@/domain';
import type { Symbol } from '@/api';
import { colors, spacing, fontSize } from '@/theme';
import {
  getWatchlist,
  removeFromWatchlist,
} from '@/repositories/WatchlistRepository';

export function WatchlistScreen({
  onOpen,
  onBack,
}: {
  onOpen: (s: Symbol) => void;
  onBack?: () => void;
}): React.JSX.Element {
  const [watch, setWatch] = useState<Symbol[]>([]);
  const { data, loading, error, reload } = useQuotes(watch);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    getWatchlist().then(setWatch);
  }, []);

  const onRemove = async (s: Symbol) => {
    const next = await removeFromWatchlist(s);
    setWatch(next);
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right },
      ]}
    >
      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity style={styles.backBtn} onPress={onBack}>
            <Text style={styles.backText}>‹</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>自选股</Text>
        <Text style={styles.source}>数据源：{marketData.activeSourceId}</Text>
      </View>
      {error && <Text style={styles.error}>加载失败：{error}</Text>}
      <FlatList
        data={data ?? []}
        keyExtractor={(q) => toFullCode(q.symbol)}
        onRefresh={reload}
        refreshing={loading}
        renderItem={({ item }) => {
          const chg = item.last - item.prevClose;
          const pct = item.prevClose ? (chg / item.prevClose) * 100 : 0;
          const up = chg >= 0;
          return (
            <TouchableOpacity style={styles.row} onPress={() => onOpen(item.symbol)}>
              <View style={styles.nameCol}>
                <Text style={styles.name}>{displaySymbol(item.symbol, item.symbol.name)}</Text>
              </View>
              <Text style={styles.price}>{item.last.toFixed(2)}</Text>
              <Text style={[styles.chg, { color: up ? colors.up : colors.down }]}>
                {up ? '+' : ''}
                {pct.toFixed(2)}%
              </Text>
              <TouchableOpacity style={styles.delBtn} onPress={() => onRemove(item.symbol)}>
                <Text style={styles.delText}>✕</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  backBtn: { marginRight: spacing.sm, paddingHorizontal: spacing.xs },
  backText: { color: colors.primary, fontSize: fontSize.xl, fontWeight: '700' },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  source: { color: colors.textSecondary, fontSize: fontSize.xs },
  error: { color: colors.down, fontSize: fontSize.sm, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  nameCol: { flex: 1 },
  name: { color: colors.text, fontSize: fontSize.md },
  price: { color: colors.text, fontSize: fontSize.md, width: 90, textAlign: 'right' },
  chg: { width: 80, textAlign: 'right', fontSize: fontSize.md },
  delBtn: { marginLeft: spacing.sm, paddingHorizontal: spacing.xs },
  delText: { color: colors.textSecondary, fontSize: fontSize.md },
});
