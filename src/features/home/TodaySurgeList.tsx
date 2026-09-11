/**
 * 今日异动榜：盘口异动 / 快速飙升。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { marketData, type TodaySurgeItem } from '@/data/api';
import { spacing, fontSize, fontWeight } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { Card, Section } from '@/components';

export function TodaySurgeList({
  onPress,
  limit = 8,
}: {
  onPress: (s: TodaySurgeItem) => void;
  limit?: number;
}): React.JSX.Element | null {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const [items, setItems] = useState<TodaySurgeItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    marketData
      .getStockTodaySurge({ limit: 30 })
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
      <Section title="今日异动" />
      <Card padded={false}>
        {!loaded ? (
          <View style={styles.row}>
            <Text style={styles.sub}>加载中…</Text>
          </View>
        ) : (
          items.map((it, i) => {
            const pct = it.changePct;
            return (
              <TouchableOpacity
                key={`${it.symbol.code}_${i}`}
                style={[styles.row, i === items.length - 1 && styles.rowLast]}
                onPress={() => onPress(it)}
                activeOpacity={0.7}
              >
                <View style={styles.left}>
                  <Text style={styles.name} numberOfLines={1}>
                    {it.name || it.symbol.name || it.symbol.code}
                  </Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {it.changeType || '异动'}
                    {it.info ? ` · ${it.info}` : ''}
                  </Text>
                </View>
                {pct != null && Number.isFinite(pct) && (
                  <Text style={[styles.pct, { color: pct >= 0 ? colors.up : colors.down }]}>
                    {pct >= 0 ? '+' : ''}
                    {pct.toFixed(2)}%
                  </Text>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </Card>
    </>
  );
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
    left: { flex: 1, marginRight: spacing.sm },
    name: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
    sub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    pct: { fontSize: fontSize.sm, fontWeight: fontWeight.bold as any },
  });
}
