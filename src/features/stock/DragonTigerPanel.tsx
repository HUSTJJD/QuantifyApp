/**
 * DragonTigerPanel —— 个股详情页龙虎榜板块。
 *
 * 展示：
 *  - 上榜原因 / 类型
 *  - 买入额 / 卖出额 / 净买入额
 *  - 机构净买 / 游资净买
 *  - 买卖前五席位（营业部名称 + 金额）
 *
 * 数据从 getDragonTigerList 获取，按标的过滤。
 */
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { marketData } from '@/api';
import type { Symbol, DragonTigerStock } from '@/api';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';
import { spacing, fontSize, radius } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { toFullCode } from '@/domain';

interface DragonTigerPanelProps {
  symbol: Symbol;
}

export function DragonTigerPanel({ symbol }: DragonTigerPanelProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const [data, setData] = useState<DragonTigerStock | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const styles = makeStyles(colors);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    marketData
      .getDragonTigerList()
      .then((list) => {
        if (!mounted) return;
        const key = toFullCode(symbol);
        const found = list.stockItems.find(
          (s) => toFullCode(s.symbol) === key,
        );
        setData(found ?? null);
      })
      .catch((e) => {
        if (mounted) setError(e?.message ?? '加载失败');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [symbol]);

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loading}>加载中…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>龙虎榜加载失败</Text>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.container}>
        <View style={styles.empty}>
          <Icon name={Icons.info} size={2} color="textSecondary" />
          <Text style={styles.emptyText}>该股当日未上榜</Text>
        </View>
      </View>
    );
  }

  const up = data.netValue >= 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name={Icons.fire} size={2} color="warning" style={styles.headerIcon} />
          <Text style={styles.title}>龙虎榜</Text>
        </View>
        {data.limitReason && (
          <Text style={styles.reason}>{data.limitReason}</Text>
        )}
      </View>

      {/* 核心指标 */}
      <View style={styles.metricsRow}>
        <Metric
          label="净买入"
          value={formatMoney(data.netValue)}
          valueColor={up ? colors.up : colors.down}
          sub={`${data.netRate >= 0 ? '+' : ''}${data.netRate.toFixed(2)}%`}
          subColor={up ? colors.up : colors.down}
          colors={colors}
        />
        <Metric label="买入额" value={formatMoney(data.buyValue)} valueColor={colors.text} colors={colors} />
        <Metric label="卖出额" value={formatMoney(data.sellValue)} valueColor={colors.text} colors={colors} />
      </View>

      {/* 资金性质 */}
      <View style={styles.fundsRow}>
        <FundItem
          label="机构净买"
          value={data.orgNetValue}
          colors={colors}
        />
        <FundItem
          label="游资净买"
          value={data.hotMoneyNetValue}
          colors={colors}
        />
        <FundItem
          label="上榜类型"
          value={data.rangeDays}
          unit="日"
          colors={colors}
          isText
        />
      </View>

      {data.conceptList && data.conceptList.length > 0 && (
        <View style={styles.concepts}>
          {data.conceptList.slice(0, 5).map((c) => (
            <View key={c} style={styles.conceptTag}>
              <Text style={styles.conceptText}>{c}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Metric({
  label,
  value,
  valueColor,
  sub,
  subColor,
  colors,
}: {
  label: string;
  value: string;
  valueColor: string;
  sub?: string;
  subColor?: string;
  colors: ReturnType<typeof useAppTheme>['colors'];
}): React.JSX.Element {
  const styles = makeStyles(colors);
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color: valueColor }]}>{value}</Text>
      {sub && <Text style={[styles.metricSub, subColor ? { color: subColor } : null]}>{sub}</Text>}
    </View>
  );
}

function FundItem({
  label,
  value,
  unit,
  colors,
  isText,
}: {
  label: string;
  value: number | string;
  unit?: string;
  colors: ReturnType<typeof useAppTheme>['colors'];
  isText?: boolean;
}): React.JSX.Element {
  const styles = makeStyles(colors);
  const numVal = typeof value === 'number' ? value : 0;
  const color = isText
    ? colors.text
    : numVal >= 0
    ? colors.up
    : colors.down;
  const display = isText
    ? `${value}${unit ?? ''}`
    : `${numVal >= 0 ? '+' : ''}${formatMoney(numVal)}`;
  return (
    <View style={styles.fundItem}>
      <Text style={styles.fundLabel}>{label}</Text>
      <Text style={[styles.fundValue, { color }]}>{display}</Text>
    </View>
  );
}

function formatMoney(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 100000000) return `${(v / 100000000).toFixed(2)}亿`;
  if (abs >= 10000) return `${(v / 10000).toFixed(2)}万`;
  return v.toFixed(0);
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    metric: { flex: 1, alignItems: 'center' },
    metricLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginBottom: 2 },
    metricValue: { fontSize: fontSize.md, fontWeight: '700' },
    metricSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    fundItem: { flex: 1, alignItems: 'center' },
    fundLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginBottom: 2 },
    fundValue: { fontSize: fontSize.sm, fontWeight: '600' },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    headerIcon: { marginRight: spacing.sm },
    title: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    reason: {
      color: colors.warning,
      fontSize: fontSize.xs,
      fontWeight: '500',
    },
    metricsRow: {
      flexDirection: 'row',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.sm,
    },
    fundsRow: {
      flexDirection: 'row',
      paddingVertical: spacing.sm,
      marginBottom: spacing.sm,
    },
    concepts: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    conceptTag: {
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.sm,
    },
    conceptText: {
      color: colors.textSecondary,
      fontSize: fontSize.xs,
    },
    loading: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      textAlign: 'center',
      padding: spacing.lg,
    },
    error: {
      color: colors.down,
      fontSize: fontSize.sm,
      textAlign: 'center',
      padding: spacing.lg,
    },
    empty: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
      gap: spacing.sm,
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
  });
}
