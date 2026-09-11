/**
 * 标签：小圆角徽标，用于买卖信号、板块标记。
 * variant: 'buy' | 'sell' | 'neutral' 或自定义 color。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '@/theme/ThemeProvider';
import { fontSize, radius } from '@/theme';

export function Tag({
  text,
  variant = 'neutral',
  color,
}: {
  text: string;
  variant?: 'buy' | 'sell' | 'neutral';
  color?: string;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const bg =
    color ?? (variant === 'buy' ? colors.up : variant === 'sell' ? colors.down : colors.surfaceAlt);
  return (
    <View style={[styles.tag, { backgroundColor: bg }]}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { borderRadius: radius.sm, paddingHorizontal: 5, paddingVertical: 1 },
  text: { color: '#fff', fontSize: fontSize.xs, fontWeight: '700' },
});
