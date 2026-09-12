/**
 * 回测中心（入口页）：选择策略 → 进入完整回测报告（自选池 / 样本外 / 参数扫描）。
 * 取数走 loadBacktestSeries 可信链路（不复权 + 除权事件）。
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { getProfiles } from '@/quant/profileStore';
import type { StrategyProfile } from '@/quant/profile';
import { SESSION_LABELS, PERIOD_LABELS } from '@/quant/profile';
import { getGroups } from '@/data/repositories/WatchlistRepository';
import { getAppPrefs, DEFAULT_PREFS } from '@/settings/appPrefs';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, fontWeight, layout } from '@/theme';
import { Card, Section, EmptyState, Tag } from '@/components';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';

export function BacktestScreen({
  onBack,
  onOpenStrategyBacktest,
}: {
  onBack?: () => void;
  onOpenStrategyBacktest: (strategyId: string) => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [profiles, setProfiles] = useState<StrategyProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [poolSize, setPoolSize] = useState(0);
  const [initCash, setInitCash] = useState(DEFAULT_PREFS.defaultInitCash);
  const styles = makeStyles(colors);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, groups, prefs] = await Promise.all([
        getProfiles(),
        getGroups(),
        getAppPrefs().catch(() => DEFAULT_PREFS),
      ]);
      setProfiles(ps);
      const n = new Set<string>();
      for (const g of groups) {
        for (const s of g.symbols ?? []) n.add(`${s.code}.${s.exchange}`);
      }
      setPoolSize(n.size);
      setInitCash(prefs.defaultInitCash);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <ScrollView
      style={[styles.root, { paddingTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
    >
      <View style={styles.header}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} hitSlop={8}>
            <Text style={styles.back}>‹ 返回</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={styles.title}>回测中心</Text>
      </View>

      <Card style={styles.intro}>
        <Text style={styles.introTitle}>可信回测链路</Text>
        <Text style={styles.introDesc}>
          自选池（最多 12 只）· 不复权 + 除权事件回放 · 佣金/印花税/过户费 · 可选滑点与次日开盘成交 ·
          样本外 walk-forward · 参数网格 TopN
        </Text>
        <Text style={styles.introMeta}>
          样本池 {poolSize} 只自选 · 初始资金 {initCash.toLocaleString('zh-CN')} 元
        </Text>
      </Card>

      <Section title="选择策略" />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
      ) : profiles.length === 0 ? (
        <EmptyState
          text="还没有策略档案"
          hint="到「策略」页从内置模板新建，再回来回测"
          icon={Icons.strategy}
        />
      ) : (
        profiles.map((p) => (
          <TouchableOpacity
            key={p.id}
            activeOpacity={0.85}
            onPress={() => onOpenStrategyBacktest(p.id)}
            style={styles.card}
          >
            <View style={styles.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={styles.cardSub}>
                  {PERIOD_LABELS[p.trade.period] ?? p.trade.period} · {SESSION_LABELS[p.trade.session] ?? p.trade.session}
                  {' · 仓位 '}
                  {(p.trade.positionRatio * 100).toFixed(0)}%
                </Text>
              </View>
              <Icon name={Icons.chevronRight} size="md" color="textSecondary" />
            </View>
            <View style={styles.tagRow}>
              <Tag
                text={p.enabled ? '已启用' : '未启用'}
                variant={p.enabled ? 'buy' : 'neutral'}
              />
              {p.autoTrade ? <Tag text="自动交易" variant="neutral" color={colors.info} /> : null}
              {p.exit.stopLossPct > 0 ? (
                <Tag text={`止损 ${p.exit.stopLossPct}%`} variant="neutral" color={colors.warning} />
              ) : null}
              {p.exit.takeProfitPct > 0 ? (
                <Tag text={`止盈 ${p.exit.takeProfitPct}%`} variant="neutral" color={colors.up} />
              ) : null}
            </View>
            <Text style={styles.cardHint}>进入完整报告：池汇总 · 单标的详报 · 样本外 · 参数扫描</Text>
          </TouchableOpacity>
        ))
      )}

      <Text style={styles.footerNote}>
        回测不等于未来收益。开启费用与滑点、看样本外衰减后再决定是否上模拟盘。
      </Text>
    </ScrollView>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.md },
    header: { marginBottom: spacing.sm },
    back: { color: colors.primary, fontSize: fontSize.md, marginBottom: spacing.xs },
    title: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold as any },
    intro: { marginBottom: spacing.md },
    introTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', marginBottom: spacing.xs },
    introDesc: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 16 },
    introMeta: { color: colors.primary, fontSize: fontSize.xs, marginTop: spacing.sm },
    card: {
      backgroundColor: colors.surface,
      borderRadius: layout.radiusCard,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    cardTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
    cardSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
    cardHint: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: spacing.sm },
    footerNote: {
      color: colors.textSecondary,
      fontSize: fontSize.xs,
      lineHeight: 16,
      marginTop: spacing.md,
      paddingHorizontal: spacing.xs,
    },
  });
}
