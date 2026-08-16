/**
 * SortToggle —— 自选股排序切换组件。
 *
 * 紧凑的分段控件样式，支持多种排序方式切换。
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';
import { spacing, fontSize, radius } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';

export type SortMode = 'default' | 'pctDesc' | 'pctAsc' | 'priceDesc' | 'priceAsc';

interface SortToggleProps {
  mode: SortMode;
  onChange: (mode: SortMode) => void;
}

const OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'default', label: '默认' },
  { value: 'pctDesc', label: '涨幅' },
  { value: 'pctAsc', label: '跌幅' },
  { value: 'priceDesc', label: '价高' },
  { value: 'priceAsc', label: '价低' },
];

export function SortToggle({ mode, onChange }: SortToggleProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);

  return (
    <View style={styles.container}>
      <Icon name={Icons.sortAsc} size={2} color="textSecondary" style={styles.icon} />
      {OPTIONS.map((opt) => {
        const active = opt.value === mode;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.item, active && styles.itemActive]}
            onPress={() => onChange(opt.value)}
          >
            <Text style={[styles.itemText, active && styles.itemTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      padding: 2,
      alignSelf: 'flex-start',
    },
    icon: { marginHorizontal: spacing.sm },
    item: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.sm,
      marginRight: 2,
    },
    itemActive: {
      backgroundColor: colors.surface,
    },
    itemText: {
      color: colors.textSecondary,
      fontSize: fontSize.xs,
      fontWeight: '500',
    },
    itemTextActive: {
      color: colors.primary,
      fontWeight: '600',
    },
  });
}
