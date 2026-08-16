/**
 * 页面顶部条：统一品牌标题 + 右侧操作位。
 * 用法：<PageHeader title="行情" right={<IconButton .../>} />
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, fontWeight, radius } from '@/theme';

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <View style={styles.titleCol}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {subtitle && <Text style={[styles.sub, { color: colors.textSecondary }]}>{subtitle}</Text>}
      </View>
      {right && <View style={styles.right}>{right}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleCol: { flex: 1 },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy as any },
  sub: { fontSize: fontSize.xs, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
