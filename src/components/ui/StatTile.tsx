/**
 * 指标块：大数字 + 标签，用于信号统计、资产概览等。
 * color 可传语义色（如 colors.up/down）。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, fontWeight } from '@/theme';

export function StatTile({
  value,
  label,
  color,
  width = 56,
}: {
  value: string | number;
  label: string;
  color?: string;
  width?: number;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.tile, { width }]}>
      <Text style={[styles.num, { color: color ?? colors.text }]}>{value}</Text>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center' },
  num: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy as any },
  label: { fontSize: fontSize.xs, marginTop: 2 },
});
