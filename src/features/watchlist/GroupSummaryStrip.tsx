/**
 * GroupSummaryStrip —— 自选分组顶区 2×2 摘要条（Opptrix watchlist groups 模式）。
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, layout, fontWeight } from '@/theme';

export interface GroupSummary {
  count: number;
  upCount: number;
  downCount: number;
  signalCount: number;
}

export function GroupSummaryStrip({
  summary,
  onPressSignals,
}: {
  summary: GroupSummary;
  onPressSignals?: () => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const cells: Array<{ label: string; value: string; color?: string; onPress?: () => void }> = [
    { label: '标的', value: String(summary.count) },
    { label: '上涨', value: String(summary.upCount), color: colors.up },
    { label: '下跌', value: String(summary.downCount), color: colors.down },
    {
      label: '信号',
      value: String(summary.signalCount),
      color: summary.signalCount > 0 ? colors.primary : undefined,
      onPress: onPressSignals,
    },
  ];

  return (
    <View style={styles.strip}>
      {cells.map((c) => {
        const inner = (
          <View style={styles.cell} key={c.label}>
            <Text style={[styles.value, c.color ? { color: c.color } : null]}>{c.value}</Text>
            <Text style={styles.label}>{c.label}</Text>
          </View>
        );
        if (c.onPress) {
          return (
            <TouchableOpacity key={c.label} onPress={c.onPress} activeOpacity={0.7} style={styles.cellTouch}>
              {inner}
            </TouchableOpacity>
          );
        }
        return inner;
      })}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    strip: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceMuted,
      borderRadius: layout.radiusCard,
      paddingVertical: spacing.sm,
      marginBottom: spacing.sm,
    },
    cell: { flex: 1, alignItems: 'center', gap: spacing.xxs },
    cellTouch: { flex: 1 },
    value: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold as any,
      fontVariant: ['tabular-nums'],
    },
    label: { color: colors.textSecondary, fontSize: fontSize.xs },
  });
}
