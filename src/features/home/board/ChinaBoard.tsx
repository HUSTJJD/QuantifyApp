/**
 * ChinaBoard — A 股大盘密集网格 + 北向/两融脉搏 + 焦点指数日内近似走势。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Quote, Symbol } from '@/data/api';
import { marketData, type MarginAccountStat, type NorthboundFlowSummaryItem } from '@/data/api';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize } from '@/theme';
import { MiniDaySparkline } from '@/components/ui/MiniDaySparkline';
import { Skeleton } from '@/components/ui/Skeleton';
import { CN_BOARD_INDICES, fullCodeOf, fmtIndexPrice, fmtPct, fmtYi, quotePct } from './format';

interface Props {
  quotes: Quote[] | null;
  loading?: boolean;
  focusSymbol: Symbol;
  focusQuote?: Quote | null;
  selectedFullCode: string;
}

export function ChinaBoard({
  quotes,
  loading,
  focusSymbol,
  focusQuote,
  selectedFullCode,
}: Props): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const [nb, setNb] = useState<NorthboundFlowSummaryItem | null>(null);
  const [margin, setMargin] = useState<MarginAccountStat | null>(null);

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
          const total =
            list.find((x) => x.boardName?.includes('合计') || x.direction === 'all') ?? list[0] ?? null;
          setNb(total);
        }
        if (ms.status === 'fulfilled') {
          const list = ms.value ?? [];
          setMargin(list.length > 0 ? list[list.length - 1] : null);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const byCode = useMemo(() => {
    const m = new Map<string, Quote>();
    (quotes ?? []).forEach((q) => m.set(fullCodeOf(q.symbol), q));
    return m;
  }, [quotes]);

  const focusName = focusSymbol.name || '上证指数';
  const focusPct = quotePct(focusQuote);
  const focusHas = !!focusQuote && focusQuote.last > 0;

  const nbVal = nb?.netBuyAmount ?? nb?.netInflow;

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={styles.title}>A 股大盘</Text>
        <Text style={styles.focusTag}>{focusName}</Text>
      </View>

      {loading && !quotes ? (
        <Skeleton shape="card" height={96} />
      ) : (
        <View style={styles.grid}>
          {CN_BOARD_INDICES.map((s) => {
            const key = fullCodeOf(s);
            const q = byCode.get(key);
            const pct = quotePct(q);
            const has = !!q && q.last > 0;
            const up = pct >= 0;
            const selected = key === selectedFullCode;
            return (
              <View key={key} style={[styles.cell, selected && styles.cellSelected]}>
                <Text style={styles.cellName} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={[styles.cellPrice, !has && styles.dim]}>
                  {has ? fmtIndexPrice(q.last) : '--'}
                </Text>
                <Text
                  style={[
                    styles.cellPct,
                    { color: has ? (up ? colors.up : colors.down) : colors.flat },
                  ]}
                >
                  {has ? fmtPct(pct) : '--'}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {/* 焦点指数日内近似走势 */}
      <View style={styles.sparkBox}>
        <View style={styles.sparkMeta}>
          <Text style={styles.sparkLabel}>日内</Text>
          <Text
            style={[
              styles.sparkPct,
              { color: focusHas ? (focusPct >= 0 ? colors.up : colors.down) : colors.flat },
            ]}
          >
            {focusHas ? fmtPct(focusPct) : '--'}
          </Text>
        </View>
        {focusQuote ? (
          <MiniDaySparkline
            quote={focusQuote}
            width={220}
            height={48}
            color={focusPct >= 0 ? colors.up : colors.down}
          />
        ) : (
          <View style={styles.sparkEmpty}>
            <Text style={styles.dimText}>走势加载中</Text>
          </View>
        )}
      </View>

      {(nbVal != null || margin) && (
        <View style={styles.pulseRow}>
          <View style={styles.pulseItem}>
            <Text style={styles.pulseLabel}>北向净买</Text>
            <Text
              style={[
                styles.pulseVal,
                { color: nbVal == null ? colors.textSecondary : nbVal >= 0 ? colors.up : colors.down },
              ]}
            >
              {fmtYi(nbVal)}
            </Text>
          </View>
          <View style={styles.pulseDivider} />
          <View style={styles.pulseItem}>
            <Text style={styles.pulseLabel}>融资余额</Text>
            <Text style={styles.pulseVal}>{fmtYi(margin?.finBalance)}</Text>
          </View>
          <View style={styles.pulseDivider} />
          <View style={styles.pulseItem}>
            <Text style={styles.pulseLabel}>融券余额</Text>
            <Text style={styles.pulseVal}>{fmtYi(margin?.loanBalance)}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    wrap: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    headRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    title: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
    focusTag: { color: colors.textSecondary, fontSize: fontSize.micro },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -4,
    },
    cell: {
      width: '33.33%',
      paddingHorizontal: 4,
      paddingVertical: spacing.sm,
      borderLeftWidth: 0,
    },
    cellSelected: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 6,
    },
    cellName: { color: colors.textSecondary, fontSize: fontSize.micro, marginBottom: 2 },
    cellPrice: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    cellPct: {
      fontSize: fontSize.xs,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
      marginTop: 2,
    },
    dim: { color: colors.flat },
    sparkBox: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    sparkMeta: { marginRight: spacing.sm },
    sparkLabel: { color: colors.textSecondary, fontSize: fontSize.micro, marginBottom: 2 },
    sparkPct: { fontSize: fontSize.sm, fontWeight: '700', fontVariant: ['tabular-nums'] },
    sparkEmpty: { width: 220, height: 48, alignItems: 'center', justifyContent: 'center' },
    dimText: { color: colors.flat, fontSize: fontSize.xs },
    pulseRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    pulseItem: { flex: 1, alignItems: 'center' },
    pulseDivider: { width: StyleSheet.hairlineWidth, height: 24, backgroundColor: colors.border },
    pulseLabel: { color: colors.textSecondary, fontSize: fontSize.micro },
    pulseVal: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      marginTop: 2,
    },
  });
}
