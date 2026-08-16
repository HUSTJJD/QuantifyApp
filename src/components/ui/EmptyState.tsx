/**
 * 空状态：图标位 + 文案，用于列表为空 / 加载失败兜底。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize } from '@/theme';

export function EmptyState({
  text,
  hint,
}: {
  text: string;
  hint?: string;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.text, { color: colors.textSecondary }]}>{text}</Text>
      {hint && <Text style={[styles.hint, { color: colors.textSecondary }]}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: spacing.xl, alignItems: 'center' },
  text: { fontSize: fontSize.md },
  hint: { fontSize: fontSize.xs, marginTop: spacing.xs },
});
