/**
 * 首页大盘资金流：主力净流入 + 超大/大/中/小单结构。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { marketData, type MarketFundFlowPoint } from '@/data/api';
import { spacing, fontSize, fontWeight } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { Card, Section } from '@/components';

function fmtYi(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const yi = v / 1e8;
  const abs = Math.abs(yi);
  if (abs >= 10000) return `${(yi / 10000).toFixed(2)}万亿`;
  return `${yi >= 0 ? '+' : ''}${yi.toFixed(2)}亿`;
}

export function FundFlowCard(): React.JSX.Element | null {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const [point, setPoint] = useState<MarketFundFlowPoint | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    marketData
      .getMarketFundFlow()
      .then((rows) => {
        if (!alive) return;
        const list = rows ?? [];
        setPoint(list.length > 0 ? list[list.length - 1] : null);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loaded && !point) return null;

  const main = point?.mainNetInflow;
  const mainColor = main == null ? colors.textSecondary : main >= 0 ? colors.up : colors.down;

  const parts: { label: string; value: number | null | undefined }[] = [
    { label: '超大单', value: point?.superLargeNetInflow },
    { label: '大单', value: point?.largeNetInflow },
    { label: '中单', value: point?.mediumNetInflow },
    { label: '小单', value: point?.smallNetInflow },
  ];

  return (
    <>
      <Section title="大盘资金流" />
      <Card>
        <View style={styles.mainRow}>
          <View>
            <Text style={styles.label}>主力净流入</Text>
            <Text style={[styles.mainValue, { color: mainColor }]}>{fmtYi(main)}</Text>
          </View>
          {point?.date ? <Text style={styles.date}>{point.date}</Text> : null}
        </View>
        <View style={styles.grid}>
          {parts.map((p) => (
            <View key={p.label} style={styles.cell}>
              <Text style={styles.cellLabel}>{p.label}</Text>
              <Text
                style={[
                  styles.cellValue,
                  {
                    color:
                      p.value == null
                        ? colors.textSecondary
                        : p.value >= 0
                          ? colors.up
                          : colors.down,
                  },
                ]}
              >
                {fmtYi(p.value)}
              </Text>
            </View>
          ))}
        </View>
        {!loaded && <Text style={styles.label}>加载中…</Text>}
      </Card>
    </>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    mainRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: spacing.sm,
    },
    label: { color: colors.textSecondary, fontSize: fontSize.xs },
    mainValue: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy as any, marginTop: 2 },
    date: { color: colors.textSecondary, fontSize: fontSize.xs },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    cell: { width: '25%', alignItems: 'center', paddingVertical: spacing.xs },
    cellLabel: { color: colors.textSecondary, fontSize: fontSize.xs },
    cellValue: { fontSize: fontSize.xs, fontWeight: '600', marginTop: 2 },
  });
}
