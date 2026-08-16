/**
 * IndexBar —— 顶部指数概览横条（上证/深证/北证）。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Quote, Symbol } from '@/api';
import { toFullCode } from '@/domain';
import { colors, spacing, fontSize, radius } from '@/theme';

const NAME_BY_CODE: Record<string, string> = {
  '000001.SH': '上证',
  '399001.SZ': '深证',
  '899050.BJ': '北证50',
};

interface Props {
  quotes?: Quote[] | null;
  loading?: boolean;
}

export function IndexBar({ quotes, loading }: Props): React.JSX.Element {
  const items: Array<{ symbol: Symbol; name: string; last: number; pct: number }> = (
    quotes ?? []
  ).map((q) => {
    const chg = q.last - q.prevClose;
    const pct = q.prevClose ? (chg / q.prevClose) * 100 : 0;
    return {
      symbol: q.symbol,
      name: NAME_BY_CODE[toFullCode(q.symbol)] ?? q.symbol.name ?? q.symbol.code,
      last: q.last,
      pct,
    };
  });

  if (loading && items.length === 0) {
    return (
      <View style={styles.bar}>
        <Text style={styles.hint}>指数加载中…</Text>
      </View>
    );
  }

  return (
    <View style={styles.bar}>
      {items.map((it) => {
        const up = it.pct >= 0;
        return (
          <View key={toFullCode(it.symbol)} style={styles.cell}>
            <Text style={styles.name}>{it.name}</Text>
            <Text style={[styles.val, { color: up ? colors.up : colors.down }]}>
              {it.last > 0 ? it.last.toFixed(2) : '--'}
            </Text>
            <Text style={[styles.pct, { color: up ? colors.up : colors.down }]}>
              {up ? '+' : ''}
              {it.pct.toFixed(2)}%
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  cell: { alignItems: 'center', flex: 1 },
  name: { color: colors.textSecondary, fontSize: fontSize.xs, marginBottom: 2 },
  val: { fontSize: fontSize.md, fontWeight: '700' },
  pct: { fontSize: fontSize.xs, marginTop: 2 },
  hint: { color: colors.textSecondary, fontSize: fontSize.sm },
});
