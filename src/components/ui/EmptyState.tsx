/**
 * 空状态：标题 + 引导文案 + 可选主操作按钮（OpenStock 空态模式）。
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, radius, fontWeight, layout } from '@/theme';
import { Icon } from './Icon';
import type { IconName } from '@/assets/icons';

export function EmptyState({
  text,
  hint,
  icon,
  actionLabel,
  onAction,
}: {
  text: string;
  hint?: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.wrap}>
      {icon ? <Icon name={icon} size="xl" color="textSecondary" /> : null}
      <Text style={styles.text}>{text}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity style={styles.btn} onPress={onAction} activeOpacity={0.85}>
          <Text style={styles.btnText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    wrap: { paddingVertical: spacing.xl, alignItems: 'center', gap: spacing.xs },
    text: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.semibold as any },
    hint: {
      color: colors.textSecondary,
      fontSize: fontSize.xs,
      textAlign: 'center',
      paddingHorizontal: spacing.lg,
      lineHeight: 16,
    },
    btn: {
      marginTop: spacing.md,
      backgroundColor: colors.primary,
      borderRadius: layout.radiusControl,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      minHeight: 36,
      justifyContent: 'center',
    },
    btnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '600' },
  });
}
