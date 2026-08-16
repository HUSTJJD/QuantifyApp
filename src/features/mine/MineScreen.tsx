/**
 * "我的"聚合页：把资产、设置、诊断（调试）等低频功能收敛到一处，
 * 避免底部导航过于拥挤（P4 信息架构收敛为 4 tab 的一部分）。
 * 各功能仍为独立二级页，由本页跳转。
 */
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, fontWeight, radius } from '@/theme';
import { Card, Section } from '@/components';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';
import { BRAND } from '@/brand';

export function MineScreen({
  onOpenAsset,
  onOpenSettings,
  onOpenDebug,
  onOpenApiStats,
  onOpenBacktest,
  onOpenScanner,
}: {
  onOpenAsset: () => void;
  onOpenSettings: () => void;
  onOpenDebug: () => void;
  onOpenApiStats: () => void;
  onOpenBacktest: () => void;
  onOpenScanner?: () => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top }]} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom }]}>
      {/* 品牌卡 */}
      <Card style={styles.brandCard}>
        <View style={styles.brandRow}>
          <Icon name={Icons.chart} size={2} color="primary" style={styles.brandIcon} />
          <View>
            <Text style={styles.brandName}>{BRAND.name}</Text>
            <Text style={styles.brandSlogan}>{BRAND.slogan}</Text>
          </View>
        </View>
      </Card>

      <Section title="我的" />

      <MenuLink icon={Icons.wallet} title="我的资产" desc="持仓与资产走势" onPress={onOpenAsset} colors={colors} />
      <MenuLink icon={Icons.cog} title="设置" desc="主题 · 数据源 · API Key" onPress={onOpenSettings} colors={colors} />

      <Section title="诊断" />
      <MenuLink icon={Icons.chartPie} title="行情源统计" desc="成功率 · 延迟 · 覆盖，仅统计不主动请求" onPress={onOpenApiStats} colors={colors} />
      <MenuLink icon={Icons.bug} title="调试日志" desc="最近请求与错误明细" onPress={onOpenDebug} colors={colors} />

      <Section title="量化工具" />
      <MenuLink icon={Icons.chart} title="策略回测" desc="历史回放 · 绩效评估" onPress={onOpenBacktest} colors={colors} />
      {onOpenScanner && (
        <MenuLink icon={Icons.search} title="全市场扫描" desc="基于本地库筛选 MACD 金叉等" onPress={onOpenScanner} colors={colors} />
      )}
    </ScrollView>
  );
}

function MenuLink({
  icon,
  title,
  desc,
  onPress,
  colors,
}: {
  icon: string;
  title: string;
  desc?: string;
  onPress: () => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
}): React.JSX.Element {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.link} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.linkIcon, { backgroundColor: colors.surfaceAlt }]}>
        <Icon name={icon} size={2} color="primary" />
      </View>
      <View style={styles.linkText}>
        <Text style={styles.linkTitle}>{title}</Text>
        {desc && <Text style={styles.linkDesc}>{desc}</Text>}
      </View>
      <Icon name={Icons.chevronRight} size={2} color="textSecondary" />
    </TouchableOpacity>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.md },
    brandCard: { marginBottom: spacing.md },
    brandRow: { flexDirection: 'row', alignItems: 'center' },
    brandIcon: { marginRight: spacing.sm },
    brandName: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.heavy as any },
    brandSlogan: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    link: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      marginBottom: spacing.xs,
      borderWidth: 1,
      borderColor: colors.border,
    },
    linkIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
    linkText: { flex: 1 },
    linkTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.medium as any },
    linkDesc: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  });
}
