/**
 * 区块标题：统一 Section 头（标题 + 右侧操作）。
 * 用法：<Section title="自选股" action={<Text>管理</Text>} />
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, fontWeight } from '@/theme';

export function Section({
  title,
  action,
  style,
}: {
  title: string;
  action?: React.ReactNode;
  style?: object;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.head, style]}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {action && <View>{action}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold as any },
});
