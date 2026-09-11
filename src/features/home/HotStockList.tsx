/**
 * 首页热股榜：人气前 N，点击进个股详情。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { marketData, type HotStock } from '@/data/api';
import { spacing, fontSize, fontWeight } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { Card, Section } from '@/components';

export function HotStockList({
  onPress,
  limit = 8,
}: {
  onPress: (s: HotStock) => void;
  limit?: number;
}): React.JSX.Element | null {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const [items, setItems] = useState<HotStock[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    marketData
      .getHotStockList('day')
      .then((list) => {
        if (alive) {
          setItems((list ?? []).slice(0, limit));
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [limit]);

  if (loaded && items.length === 0) return null;

  return (
    <>
      <Section title="人气热股" />
      <Card padded={false}>
        {items.map((h, i) => (
          <TouchableOpacity
            key={`${h.symbol.code}_${h.symbol.exchange}_${i}`}
            style={[styles.row, i === items.length - 1 && styles.rowLast]}
            onPress={() => onPress(h)}
            activeOpacity={0.7}
          >
            <Text style={[styles.rank, i < 3 && { color: colors.primary }]}>{i + 1}</Text>
            <View style={styles.mid}>
              <Text style={styles.name}>{h.name || h.symbol.name || h.symbol.code}</Text>
              <Text style={styles.code}>
                {h.symbol.code}
                {h.rankChange !== 0 ? ` · 排名${h.rankChange > 0 ? '↑' : '↓'}${Math.abs(h.rankChange)}` : ''}
              </Text>
            </View>
            <Text style={styles.heat}>{h.heat > 0 ? fmtHeat(h.heat) : ''}</Text>
          </TouchableOpacity>
        ))}
        {!loaded && (
          <View style={styles.row}>
            <Text style={styles.code}>加载中…</Text>
          </View>
        )}
      </Card>
    </>
  );
}

function fmtHeat(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowLast: { borderBottomWidth: 0 },
    rank: {
      width: 22,
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold as any,
    },
    mid: { flex: 1 },
    name: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
    code: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    heat: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '600' },
  });
}
