/**
 * FundsSection — 资金·情绪折叠壳，内嵌大盘资金流 + 盘中资金流排行。
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize } from '@/theme';
import { FundFlowCard } from '../FundFlowCard';
import { FundFlowRanksCard } from '../FundFlowRanksCard';
import type { Symbol } from '@/data/api';

interface Props {
  defaultCollapsed?: boolean;
  onPressStock: (symbol: Symbol) => void;
}

export function FundsSection({
  defaultCollapsed = false,
  onPressStock,
}: Props): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.head}
        onPress={() => setCollapsed((c) => !c)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={collapsed ? '展开资金情绪' : '收起资金情绪'}
      >
        <Text style={styles.title}>资金 · 情绪</Text>
        <Text style={styles.chevron}>{collapsed ? '展开' : '收起'}</Text>
      </TouchableOpacity>
      {!collapsed && (
        <View style={styles.body}>
          <FundFlowCard />
          <FundFlowRanksCard
            onPressStock={(code, name, exchange) =>
              onPressStock({
                code,
                exchange: exchange as Symbol['exchange'],
                name,
              })
            }
          />
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    wrap: { marginTop: spacing.xs },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.sm,
    },
    title: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
    chevron: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '600' },
    body: {},
  });
}
