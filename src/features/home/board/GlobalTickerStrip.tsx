/**
 * GlobalTickerStrip — 全球主要指数横滑条。
 * 点选切换焦点指数；失败显示 `--` 不阻塞。
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import type { Quote, Symbol } from '@/data/api';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, radius } from '@/theme';
import { GLOBAL_TICKER_INDICES, fullCodeOf, fmtIndexPrice, fmtPct, quotePct } from './format';

interface Props {
  quotes: Quote[] | null;
  loading?: boolean;
  selectedFullCode: string;
  onSelect: (symbol: Symbol, fullCode: string) => void;
}

export function GlobalTickerStrip({ quotes, loading, selectedFullCode, onSelect }: Props): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);

  const byCode = useMemo(() => {
    const m = new Map<string, Quote>();
    (quotes ?? []).forEach((q) => m.set(fullCodeOf(q.symbol), q));
    return m;
  }, [quotes]);

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>全球</Text>
        {loading && !quotes ? <Text style={styles.hint}>加载中…</Text> : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {GLOBAL_TICKER_INDICES.map((item) => {
          const key = fullCodeOf(item.symbol);
          const q = byCode.get(key);
          const pct = quotePct(q);
          const has = !!q && q.last > 0;
          const up = pct >= 0;
          const selected = key === selectedFullCode;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.cell, selected && styles.cellSelected]}
              onPress={() => onSelect(item.symbol, key)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`${item.short} ${fmtPct(has ? pct : null)}`}
            >
              <View style={styles.nameRow}>
                <Text style={[styles.name, selected && styles.nameSelected]} numberOfLines={1}>
                  {item.short}
                </Text>
                <Text style={styles.market}>{item.market}</Text>
              </View>
              <Text style={[styles.price, !has && styles.dim]}>
                {has ? fmtIndexPrice(q.last) : '--'}
              </Text>
              <Text style={[styles.pct, { color: has ? (up ? colors.up : colors.down) : colors.flat }]}>
                {has ? fmtPct(pct) : '--'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    wrap: { marginBottom: spacing.sm },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xs,
      marginBottom: spacing.xs,
    },
    title: {
      color: colors.text,
      fontSize: fontSize.sm,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    hint: { color: colors.textSecondary, fontSize: fontSize.micro },
    scroll: { gap: spacing.sm, paddingRight: spacing.md },
    cell: {
      minWidth: 88,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    cellSelected: {
      borderColor: colors.live,
      borderWidth: 1,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    name: { color: colors.textSecondary, fontSize: fontSize.micro, fontWeight: '600', flex: 1 },
    nameSelected: { color: colors.text },
    market: {
      color: colors.flat,
      fontSize: 9,
      marginLeft: 4,
      fontVariant: ['tabular-nums'],
    },
    price: {
      color: colors.text,
      fontSize: fontSize.quote,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      marginBottom: 2,
    },
    pct: {
      fontSize: fontSize.xs,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    dim: { color: colors.flat },
  });
}
