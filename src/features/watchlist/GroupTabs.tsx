/**
 * GroupTabs —— 自选股分组切换 Tab 组件。
 *
 * 横向滚动的分组 Tab 栏，支持：
 *  - 当前分组高亮
 *  - 新建分组按钮（+）
 *  - 横向滚动（分组多时）
 *  - 点击回调 onSelect / onCreate
 */
import React from 'react';
import { Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';
import { spacing, fontSize, radius } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import type { WatchlistGroup } from '@/data/repositories/WatchlistRepository';
import { isDynamicGroup } from '@/data/repositories/WatchlistRepository';

interface GroupTabsProps {
  groups: WatchlistGroup[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate?: () => void;
}

export function GroupTabs({ groups, activeId, onSelect, onCreate }: GroupTabsProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {groups.map((g) => {
        const active = g.id === activeId;
        const dyn = isDynamicGroup(g);
        return (
          <TouchableOpacity
            key={g.id}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => onSelect(g.id)}
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>
              {dyn ? '⚡' : ''}
              {g.name}
              <Text style={styles.count}> ({g.symbols.length})</Text>
            </Text>
          </TouchableOpacity>
        );
      })}
      {onCreate && (
        <TouchableOpacity style={styles.addBtn} onPress={onCreate}>
          <Icon name={Icons.plus} size={2} color="textSecondary" />
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
      alignItems: 'center',
    },
    tab: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.lg,
      backgroundColor: colors.surfaceAlt,
      marginRight: spacing.sm,
    },
    tabActive: {
      backgroundColor: colors.primary,
    },
    tabText: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: '500',
    },
    tabTextActive: {
      color: '#fff',
      fontWeight: '600',
    },
    count: {
      fontSize: fontSize.xs,
      opacity: 0.7,
    },
    addBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
