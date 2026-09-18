/**
 * "我的"聚合页：把资产、设置、诊断（调试）等低频功能收敛到一处。
 * 各功能仍为独立二级页，由本页跳转。
 */
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, fontWeight, radius } from '@/theme';
import { Card, Section } from '@/components';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/theme/icons';
import { BRAND } from '@/theme/brand';

/** 底部 Tab 栏占位（与 HomeScreen 一致，避免最后一项被 Tab 挡住） */
const TAB_BAR_PAD = Platform.select({ ios: 56, android: 60, default: 56 });

export function MineScreen({
  onOpenAsset,
  onOpenSettings,
  onOpenDebug,
  onOpenApiStats,
  onOpenBacktest,
  onOpenScanner,
  onOpenWorkflow,
  onOpenAlertRules,
  onOpenAutomation,
}: {
  onOpenAsset: () => void;
  onOpenSettings: () => void;
  onOpenDebug: () => void;
  onOpenApiStats: () => void;
  onOpenBacktest: () => void;
  onOpenScanner?: () => void;
  onOpenWorkflow?: () => void;
  onOpenAlertRules?: () => void;
  onOpenAutomation?: () => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: (insets.bottom || 0) + TAB_BAR_PAD + spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        alwaysBounceVertical
      >
        <Card style={styles.brandCard}>
          <View style={styles.brandRow}>
            <Icon name={Icons.chart} size="lg" color="primary" style={styles.brandIcon} />
            <View style={styles.brandText}>
              <Text style={styles.brandName}>{BRAND.name}</Text>
              <Text style={styles.brandSlogan}>{BRAND.slogan}</Text>
            </View>
          </View>
        </Card>

        <Section title="我的" />

        <MenuLink icon={Icons.wallet} title="我的资产" desc="持仓与资产走势" onPress={onOpenAsset} colors={colors} />
        {onOpenAlertRules && (
          <MenuLink icon={Icons.bell} title="盯盘告警" desc="价格/指标/策略信号提醒" onPress={onOpenAlertRules} colors={colors} />
        )}
        {onOpenAutomation && (
          <MenuLink icon={Icons.clock} title="自动化" desc="盘后摘要 / 尾盘扫描 任务与运行历史" onPress={onOpenAutomation} colors={colors} />
        )}
        <MenuLink icon={Icons.cog} title="设置" desc="主题 · 数据源 · API Key" onPress={onOpenSettings} colors={colors} />

        <Section title="诊断" />
        <MenuLink icon={Icons.chartPie} title="行情源统计" desc="成功率 · 延迟 · 覆盖，仅统计不主动请求" onPress={onOpenApiStats} colors={colors} />
        <MenuLink icon={Icons.bug} title="调试日志" desc="最近请求与错误明细" onPress={onOpenDebug} colors={colors} />

        <Section title="量化工具" />
        <MenuLink icon={Icons.chart} title="策略回测" desc="历史回放 · 绩效评估" onPress={onOpenBacktest} colors={colors} />
        {onOpenScanner && (
          <MenuLink icon={Icons.search} title="全市场扫描" desc="基于本地库筛选 MACD 金叉等" onPress={onOpenScanner} colors={colors} />
        )}
        {onOpenWorkflow && (
          <MenuLink icon={Icons.strategy} title="工作流" desc="候选池 → 信号 → 批量跟单" onPress={onOpenWorkflow} colors={colors} />
        )}
      </ScrollView>
    </View>
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
        <Icon name={icon} size="md" color="primary" />
      </View>
      <View style={styles.linkText}>
        <Text style={styles.linkTitle}>{title}</Text>
        {desc && <Text style={styles.linkDesc}>{desc}</Text>}
      </View>
      <Icon name={Icons.chevronRight} size="sm" color="textSecondary" />
    </TouchableOpacity>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    content: { paddingHorizontal: spacing.md },
    brandCard: { marginBottom: spacing.md },
    brandRow: { flexDirection: 'row', alignItems: 'center' },
    brandIcon: { marginRight: spacing.sm },
    brandText: { flex: 1 },
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
    linkIcon: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.sm,
    },
    linkText: { flex: 1 },
    linkTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.medium as any },
    linkDesc: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  });
}
