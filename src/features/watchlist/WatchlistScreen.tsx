/**
 * 自选股列表页（示例 feature）。演示如何消费统一 API 与数据源切换，
 * 并把自选股持久化到客户端本地存储（WatchlistRepository）。
 */
import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { marketData } from '@/data/api';
import { useQuotes } from '@/hooks/useMarketData';
import { toFullCode, displaySymbol } from '@/domain';
import type { Symbol } from '@/data/api';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, radius, fontWeight } from '@/theme';
import {
  getWatchlist,
  removeFromWatchlist,
} from '@/data/repositories/WatchlistRepository';
import { detectAlerts, DEFAULT_ALERT_RULES, type AlertEvent } from '@/features/watchlist/alerts';
import {
  recordAlerts,
  getAlertHistory,
  clearAlertHistory,
  type AlertHistoryEntry,
} from '@/features/watchlist/alertHistory';
import { Card, Section, Tag } from '@/components';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';

export function WatchlistScreen({
  onOpen,
  onBack,
}: {
  onOpen: (s: Symbol) => void;
  onBack?: () => void;
}): React.JSX.Element {
  const { colors: c } = useAppTheme();
  const focused = useIsFocused();
  const [watch, setWatch] = useState<Symbol[]>([]);
  const [history, setHistory] = useState<AlertHistoryEntry[]>([]);
  const { data, error } = useQuotes(watch, 'stock', focused);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    getWatchlist().then(setWatch);
    getAlertHistory().then(setHistory);
  }, []);

  const onRemove = async (s: Symbol) => {
    const next = await removeFromWatchlist(s);
    setWatch(next);
  };

  const onClearHistory = async () => {
    await clearAlertHistory();
    setHistory([]);
  };

  // M4：异动检测（基于实时行情）
  const alerts: AlertEvent[] = useMemo(() => {
    if (!data || data.length === 0) return [];
    return detectAlerts(
      data.map((q) => ({ symbol: q.symbol, quote: q })),
      DEFAULT_ALERT_RULES,
    );
  }, [data]);

  // 异动落盘（去重合并），仅在确有触发时写一次
  useEffect(() => {
    if (alerts.length === 0) return;
    let cancelled = false;
    recordAlerts(alerts).then((next) => {
      if (!cancelled) setHistory(next);
    });
    return () => {
      cancelled = true;
    };
  }, [alerts]);

  const styles = makeStyles(c);

  return (
    <ScrollView
      style={[
        styles.container,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right },
      ]}
      // onRefresh={reload}
      // refreshing={loading}
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

      {/* 异动提醒区块 */}
      <Section title="异动提醒" />
      {alerts.length === 0 ? (
        <Card><Text style={styles.hint}>暂无异动（涨跌幅±5% / 巨量 / 突破20根）</Text></Card>
      ) : (
        alerts.map((a, i) => (
          <TouchableOpacity key={`${a.ruleId}-${a.symbol.code}-${i}`} style={styles.alertRow} onPress={() => onOpen(a.symbol)}>
            <Icon name={Icons.alert} size={2} color="warning" style={styles.alertIcon} />
            <View style={styles.alertText}>
              <Text style={styles.alertName}>{displaySymbol(a.symbol, a.symbol.name)}</Text>
              <Text style={styles.alertMsg}>{a.message}</Text>
            </View>
            <Tag text={a.type === 'pct' ? '涨跌' : a.type === 'volumeSpike' ? '放量' : '突破'} variant={a.type === 'pct' && a.value >= 0 ? 'buy' : 'sell'} />
          </TouchableOpacity>
        ))
      )}

      {error && <Text style={styles.error}>加载失败：{error}</Text>}

      {/* 异动历史回看区块 */}
      <Section title={`异动历史（${history.length}）`} />
      {history.length === 0 ? (
        <Card><Text style={styles.hint}>暂无记录（异动触发后将自动留存）</Text></Card>
      ) : (
        <View>
          {history.slice(0, 20).map((h, i) => (
            <TouchableOpacity key={`${h.ruleId}-${h.symbol.code}-${h.savedAt}-${i}`} style={styles.alertRow} onPress={() => onOpen(h.symbol)}>
              <Icon name={Icons.alert} size={2} color="info" style={styles.alertIcon} />
              <View style={styles.alertText}>
                <Text style={styles.alertName}>{displaySymbol(h.symbol, h.symbol.name)}</Text>
                <Text style={styles.alertMsg}>{h.message}</Text>
              </View>
              <Tag text={new Date(h.time).toLocaleString()} variant="neutral" />
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.clearBtn} onPress={onClearHistory}>
            <Text style={styles.clearText}>清空历史</Text>
          </TouchableOpacity>
        </View>
      )}

      <Section title={`自选列表（${data?.length ?? 0}）`} />
      {(data ?? []).map((item) => {
        const chg = item.last - item.prevClose;
        const pct = item.prevClose ? (chg / item.prevClose) * 100 : 0;
        const up = chg >= 0;
        return (
          <TouchableOpacity key={toFullCode(item.symbol)} style={styles.row} onPress={() => onOpen(item.symbol)}>
            <View style={styles.nameCol}>
              <Text style={styles.name}>{displaySymbol(item.symbol, item.symbol.name)}</Text>
            </View>
            <Text style={styles.price}>{item.last.toFixed(2)}</Text>
            <Text style={[styles.chg, { color: up ? c.up : c.down }]}>
              {up ? '+' : ''}
              {pct.toFixed(2)}%
            </Text>
            <TouchableOpacity style={styles.delBtn} onPress={() => onRemove(item.symbol)}>
              <Text style={styles.delText}>✕</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
    backBtn: { marginRight: spacing.sm, paddingHorizontal: spacing.xs },
    backText: { color: colors.primary, fontSize: fontSize.xl, fontWeight: '700' },
    title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
    source: { color: colors.textSecondary, fontSize: fontSize.xs },
    error: { color: colors.down, fontSize: fontSize.sm, marginBottom: spacing.sm },
    hint: { color: colors.textSecondary, fontSize: fontSize.sm, paddingVertical: spacing.sm },
    alertRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.sm,
      marginBottom: spacing.xs,
      borderWidth: 1,
      borderColor: colors.border,
    },
    alertIcon: { marginRight: spacing.sm },
    alertText: { flex: 1 },
    alertName: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.medium as any },
    alertMsg: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    clearBtn: {
      alignSelf: 'flex-end',
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      marginTop: spacing.xs,
    },
    clearText: { color: colors.textSecondary, fontSize: fontSize.xs },
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
}
