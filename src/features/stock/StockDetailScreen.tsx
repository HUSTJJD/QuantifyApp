/**
 * 个股详情页：K 线图 + 五档盘口 + 周期切换。
 */
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { marketData } from '@/api';
import { useKline } from '@/hooks/useMarketData';
import { displaySymbol } from '@/domain';
import type { KlinePeriod, OrderBook, Symbol } from '@/api';
import { KLineChart } from '@/components';
import { colors, spacing, fontSize, radius } from '@/theme';

const PERIODS: KlinePeriod[] = ['day', 'week', 'month'];
const PERIOD_LABEL: Record<KlinePeriod, string> = { day: '日K', week: '周K', month: '月K', '1m': '1分', '5m': '5分', '15m': '15分', '30m': '30分', '60m': '60分' };

export function StockDetailScreen({
  symbol,
  onBack,
  onTrade,
}: {
  symbol: Symbol;
  onBack?: () => void;
  onTrade?: (symbol: Symbol, lastPrice: number) => void;
}): React.JSX.Element {
  const [period, setPeriod] = useState<KlinePeriod>('day');
  const { data: kline, loading, error, reload: reloadKline, loadEarlier } = useKline({ symbol, period, count: 500 });
  const [book, setBook] = useState<OrderBook | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();

  const loadBook = useCallback(() => {
    let alive = true;
    marketData
      .getOrderBook(symbol)
      .then((b) => alive && setBook(b))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [symbol]);

  useEffect(() => loadBook(), [loadBook]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([reloadKline(), new Promise<void>((resolve) => { loadBook(); resolve(); })]);
    } finally {
      setRefreshing(false);
    }
  }, [reloadKline, loadBook]);

  return (
    <ScrollView
      style={[
        styles.container,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
      }
    >
      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <Text style={styles.backText}>‹ 返回</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>{displaySymbol(symbol, symbol.name)}</Text>
        {onTrade && (
          <TouchableOpacity
            style={styles.tradeBtn}
            onPress={() => {
              const last = kline && kline.length > 0 ? kline[kline.length - 1].close : 0;
              onTrade(symbol, last);
            }}
          >
            <Text style={styles.tradeBtnText}>模拟交易</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.periodBtn, period === p && styles.periodBtnActive]}
            onPress={() => setPeriod(p)}
          >
            <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
              {PERIOD_LABEL[p]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.chartBox}>
        {loading && <Text style={styles.hint}>K线加载中…</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
        {!loading && !error && kline && (
          <KLineChart data={kline} period={period} height={260} onLoadMore={loadEarlier} />
        )}
        {!loading && !error && kline && kline.length === 0 && <Text style={styles.hint}>该周期暂无数据</Text>}
      </View>

      <Text style={styles.subtitle}>五档盘口</Text>
      {book && (book.bids.length > 0 || book.asks.length > 0) ? (
        <View style={styles.book}>
          {book.asks
            .slice()
            .reverse()
            .map((a, i) => (
              <View key={`a${i}`} style={styles.bookRow}>
                <Text style={[styles.bookSide, { color: colors.down }]}>卖{i + 1}</Text>
                <Text style={[styles.bookPrice, { color: colors.down }]}>{a.price.toFixed(2)}</Text>
                <Text style={styles.bookVol}>{a.volume}</Text>
              </View>
            ))}
          {book.bids.map((b, i) => (
            <View key={`b${i}`} style={styles.bookRow}>
              <Text style={[styles.bookSide, { color: colors.up }]}>买{i + 1}</Text>
              <Text style={[styles.bookPrice, { color: colors.up }]}>{b.price.toFixed(2)}</Text>
              <Text style={styles.bookVol}>{b.volume}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.hint}>该标的暂无盘口数据</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  backBtn: { marginRight: spacing.sm },
  backText: { color: colors.primary, fontSize: fontSize.md },
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: '700', marginBottom: spacing.sm, flex: 1 },
  tradeBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  tradeBtnText: { color: '#fff', fontSize: fontSize.sm, fontWeight: '700' },
  periodRow: { flexDirection: 'row', marginBottom: spacing.sm },
  periodBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.sm,
    marginRight: spacing.sm,
    backgroundColor: colors.surface,
  },
  periodBtnActive: { backgroundColor: colors.primary },
  periodText: { color: colors.textSecondary, fontSize: fontSize.sm },
  periodTextActive: { color: '#fff', fontWeight: '700' },
  chartBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md },
  hint: { color: colors.textSecondary, fontSize: fontSize.sm, paddingVertical: spacing.md, textAlign: 'center' },
  error: { color: colors.down, fontSize: fontSize.sm, paddingVertical: spacing.md, textAlign: 'center' },
  subtitle: { color: colors.text, fontSize: fontSize.md, marginVertical: spacing.sm },
  book: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm },
  bookRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  bookSide: { fontSize: fontSize.sm, width: 48 },
  bookPrice: { fontSize: fontSize.sm, flex: 1, textAlign: 'right' },
  bookVol: { fontSize: fontSize.sm, color: colors.textSecondary, width: 80, textAlign: 'right' },
});
