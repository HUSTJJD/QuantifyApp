/**
 * 盘中资金流排行：板块 / 个股 · 流入前五 / 流出前五。
 * 数据源 stock-sdk fundFlow.rank / sectorRank（indicator=today）。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import {
  marketData,
  type FundsFlowingItem,
  type IndustryFundsFlowingItem,
} from '@/data/api';
import { spacing, fontSize, radius } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { Card, Section } from '@/components';

type Tab = 'sector' | 'stock';

function fmtYi(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const yi = v / 1e8;
  const abs = Math.abs(yi);
  if (abs >= 10000) return `${(yi / 10000).toFixed(2)}万亿`;
  if (abs < 0.01) return `${(v / 1e4).toFixed(0)}万`;
  return `${yi >= 0 ? '+' : ''}${yi.toFixed(2)}亿`;
}

function pickTop<T extends { inflow: number | null }>(arr: T[], dir: 'in' | 'out', n = 5): T[] {
  const valid = arr.filter((x) => x.inflow != null && Number.isFinite(x.inflow));
  const sorted = [...valid].sort((a, b) => (b.inflow ?? 0) - (a.inflow ?? 0));
  return dir === 'in' ? sorted.slice(0, n) : sorted.slice(-n).reverse();
}

export function FundFlowRanksCard({ onPressStock }: {
  onPressStock?: (code: string, name: string, exchange: string) => void;
}): React.JSX.Element | null {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const [tab, setTab] = useState<Tab>('sector');
  const [stocks, setStocks] = useState<FundsFlowingItem[]>([]);
  const [sectors, setSectors] = useState<IndustryFundsFlowingItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([
        marketData.getStockFundsFlowing({ period: 'today', limit: 100 }),
        marketData.getStockIndustryFundsFlowing({ period: 'today', sectorType: 'industry', limit: 80 }),
      ]);
      setStocks(s ?? []);
      setSectors(b ?? []);
      setErr(false);
    } catch {
      setErr(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  if (loaded && err && stocks.length === 0 && sectors.length === 0) return null;

  const stockRows = stocks.map((it) => ({
    key: `${it.symbol.code}.${it.symbol.exchange}`,
    name: it.name || it.symbol.name || it.symbol.code,
    code: it.symbol.code,
    exchange: it.symbol.exchange,
    inflow: it.mainNetInflow,
  }));
  const sectorRows = sectors.map((it) => ({
    key: it.code,
    name: it.name,
    code: it.code,
    // BKxxxx 东财板块 → EM；其余按 TI 同花顺板块指数
    exchange: /^BK\d+$/i.test(it.code) ? 'EM' : 'TI',
    inflow: it.mainNetInflow,
  }));
  const rows = tab === 'sector' ? sectorRows : stockRows;
  const topIn = pickTop(rows, 'in', 5);
  const topOut = pickTop(rows, 'out', 5);

  return (
    <>
      <View style={styles.sectionHead}>
        <Section title="盘中资金流" style={{ marginTop: 0, marginBottom: 0, flex: 1, paddingHorizontal: 0 }} />
        <View style={styles.tabs}>
          {(['sector', 'stock'] as Tab[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tab, tab === t && styles.tabActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'sector' ? '板块' : '个股'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <Card>
        {!loaded ? (
          <Text style={styles.hint}>加载中…</Text>
        ) : rows.length === 0 ? (
          <Text style={styles.hint}>暂无资金流数据</Text>
        ) : (
          <View style={styles.cols}>
            <View style={styles.col}>
              <Text style={[styles.colTitle, { color: colors.up }]}>流入前五</Text>
              {topIn.map((r, i) => (
                <TouchableOpacity
                  key={r.key}
                  style={styles.row}
                  disabled={tab !== 'stock' || !onPressStock}
                  onPress={() => onPressStock?.(r.code, r.name, r.exchange)}
                >
                  <Text style={styles.rank}>{i + 1}</Text>
                  <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
                  <Text style={[styles.amt, { color: colors.up }]}>{fmtYi(r.inflow)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.col}>
              <Text style={[styles.colTitle, { color: colors.down }]}>流出前五</Text>
              {topOut.map((r, i) => (
                <TouchableOpacity
                  key={r.key}
                  style={styles.row}
                  disabled={tab !== 'stock' || !onPressStock}
                  onPress={() => onPressStock?.(r.code, r.name, r.exchange)}
                >
                  <Text style={styles.rank}>{i + 1}</Text>
                  <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
                  <Text style={[styles.amt, { color: colors.down }]}>{fmtYi(r.inflow)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </Card>
    </>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    sectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.sm,
    },
    tabs: { flexDirection: 'row', gap: 4 },
    tab: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    tabText: { color: colors.text, fontSize: fontSize.xs },
    tabTextActive: { color: '#fff', fontWeight: '700' },
    hint: { color: colors.textSecondary, fontSize: fontSize.xs, paddingVertical: spacing.sm },
    cols: { flexDirection: 'row', gap: spacing.sm },
    col: { flex: 1 },
    colTitle: { fontSize: fontSize.xs, fontWeight: '600', marginBottom: spacing.xs },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
    rank: { width: 14, color: colors.textSecondary, fontSize: fontSize.xs },
    name: { flex: 1, color: colors.text, fontSize: fontSize.xs, marginRight: 4 },
    amt: { fontSize: fontSize.xs, fontWeight: '600' },
  });
}
