/**
 * 市场脉搏条：北向资金净买入 + 两融余额。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { marketData, type NorthboundFlowSummaryItem, type MarginAccountStat } from '@/data/api';
import { spacing, fontSize, fontWeight } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { Card } from '@/components';

function fmtYi(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const yi = v / 1e8;
  const abs = Math.abs(yi);
  if (abs >= 10000) return `${(yi / 10000).toFixed(2)}万亿`;
  return `${yi >= 0 ? '+' : ''}${yi.toFixed(2)}亿`;
}

export function MarketPulseBar(): React.JSX.Element | null {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const [nb, setNb] = useState<NorthboundFlowSummaryItem | null>(null);
  const [margin, setMargin] = useState<MarginAccountStat | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [nbs, ms] = await Promise.allSettled([
          marketData.getNorthboundSummary(),
          marketData.getMarginAccountInfo(),
        ]);
        if (!alive) return;
        if (nbs.status === 'fulfilled') {
          const list = nbs.value ?? [];
          // 优先沪股通+深股通合计；否则取第一条
          const total =
            list.find((x) => x.boardName?.includes('合计') || x.direction === 'all') ??
            list[0] ??
            null;
          setNb(total);
        }
        if (ms.status === 'fulfilled') {
          const list = ms.value ?? [];
          setMargin(list.length > 0 ? list[list.length - 1] : null);
        }
      } catch {
        // ignore
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loaded && !nb && !margin) return null;

  const nbVal = nb?.netBuyAmount ?? nb?.netInflow;
  const nbColor = nbVal == null ? colors.textSecondary : nbVal >= 0 ? colors.up : colors.down;

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={styles.item}>
          <Text style={styles.label}>北向净买入</Text>
          <Text style={[styles.value, { color: nbColor }]}>{fmtYi(nbVal)}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.item}>
          <Text style={styles.label}>融资余额</Text>
          <Text style={styles.value}>{fmtYi(margin?.finBalance)}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.item}>
          <Text style={styles.label}>融券余额</Text>
          <Text style={styles.value}>{fmtYi(margin?.loanBalance)}</Text>
        </View>
      </View>
      {(nb?.date || margin?.date) && (
        <Text style={styles.date}>{margin?.date ?? nb?.date}</Text>
      )}
    </Card>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    card: { marginBottom: spacing.sm },
    row: { flexDirection: 'row', alignItems: 'center' },
    item: { flex: 1, alignItems: 'center' },
    divider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: colors.border },
    label: { color: colors.textSecondary, fontSize: fontSize.xs },
    value: { fontSize: fontSize.md, fontWeight: fontWeight.bold as any, marginTop: 2 },
    date: { color: colors.textSecondary, fontSize: fontSize.xs, textAlign: 'center', marginTop: 4 },
  });
}
