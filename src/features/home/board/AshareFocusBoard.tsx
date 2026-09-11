/**
 * AshareFocusBoard — A 股个股焦点：异动 / 热股 / 主力流入 / 主力流出。
 * 列表数据 + 批量补价轮询，点击进个股详情。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import {
  marketData,
  type FundsFlowingItem,
  type HotStock,
  type Quote,
  type Symbol,
  type TodaySurgeItem,
} from '@/data/api';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, layout } from '@/theme';
import { getAppPrefs, setAppPrefs } from '@/settings/appPrefs';
import { useQuotes } from '@/hooks/useMarketData';
import { AshareQuoteRow } from './AshareQuoteRow';
import { dedupeByFullCode, fmtYi } from './format';

export type FocusTab = 'surge' | 'hot' | 'inflow' | 'outflow';

const TABS: Array<{ key: FocusTab; label: string }> = [
  { key: 'surge', label: '异动' },
  { key: 'hot', label: '热股' },
  { key: 'inflow', label: '流入' },
  { key: 'outflow', label: '流出' },
];

interface Row {
  key: string;
  symbol: Symbol;
  name: string;
  sub?: string | null;
  fallbackPrice?: number | null;
  fallbackPct?: number | null;
  inflow?: number | null;
}

const ROW_LIMIT = 10;
const QUOTE_BATCH = 20;

function rowKey(s: Symbol): string {
  return `${s.code}.${s.exchange}`;
}

export function AshareFocusBoard({
  defaultTab,
  onPressStock,
}: {
  defaultTab: FocusTab;
  onPressStock: (symbol: Symbol) => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const focused = useIsFocused();

  const [tab, setTab] = useState<FocusTab>(defaultTab);
  const [surge, setSurge] = useState<TodaySurgeItem[]>([]);
  const [hot, setHot] = useState<HotStock[]>([]);
  const [flows, setFlows] = useState<FundsFlowingItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    (async () => {
      const tasks = [
        marketData
          .getStockTodaySurge({ limit: 30 })
          .then((l) => {
            if (alive) setSurge(l ?? []);
          })
          .catch(() => undefined),
        marketData
          .getHotStockList('day')
          .then((l) => {
            if (alive) setHot(l ?? []);
          })
          .catch(() => undefined),
        marketData
          .getStockFundsFlowing({ period: 'today', limit: 80 })
          .then((l) => {
            if (alive) setFlows(l ?? []);
          })
          .catch(() => {
            if (alive) setErr(true);
          }),
      ];
      await Promise.all(tasks);
      if (alive) setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  const rows = useMemo<Row[]>(() => {
    if (tab === 'surge') {
      return dedupeByFullCode(surge)
        .slice(0, ROW_LIMIT)
        .map((it) => ({
          key: rowKey(it.symbol),
          symbol: it.symbol,
          name: it.name || it.symbol.name || it.symbol.code,
          sub: it.changeType || it.info || null,
          fallbackPrice: it.price,
          fallbackPct: it.changePct,
        }));
    }
    if (tab === 'hot') {
      return dedupeByFullCode(hot)
        .slice(0, ROW_LIMIT)
        .map((h) => ({
          key: rowKey(h.symbol),
          symbol: h.symbol,
          name: h.name || h.symbol.name || h.symbol.code,
          sub:
            h.heat > 0
              ? `热度 ${h.heat >= 1e6 ? `${(h.heat / 1e6).toFixed(1)}M` : `${(h.heat / 1e3).toFixed(1)}K`}`
              : null,
        }));
    }
    const valid = flows.filter((f) => f.mainNetInflow != null && Number.isFinite(f.mainNetInflow));
    const sorted = [...valid].sort((a, b) => (b.mainNetInflow ?? 0) - (a.mainNetInflow ?? 0));
    const picked =
      tab === 'inflow'
        ? dedupeByFullCode(sorted).slice(0, ROW_LIMIT)
        : dedupeByFullCode(sorted).slice(-ROW_LIMIT).reverse();
    return picked.map((f) => ({
      key: rowKey(f.symbol),
      symbol: f.symbol,
      name: f.name || f.symbol.name || f.symbol.code,
      sub: fmtYi(f.mainNetInflow),
      fallbackPrice: f.price,
      fallbackPct: f.changePct,
      inflow: f.mainNetInflow,
    }));
  }, [tab, surge, hot, flows]);

  const symbols = useMemo(() => rows.map((r) => r.symbol).slice(0, QUOTE_BATCH), [rows]);

  // 与首页指数条共用 useQuotes：缓存秒显 + 盘中轮询 + 失焦暂停，不再自建 15s 定时器
  const { data: quoteList } = useQuotes(symbols, 'stock', focused);
  const quotes = quoteList ?? [];

  const persistTab = useCallback((t: FocusTab) => {
    setTab(t);
    setAppPrefs({ ashareFocusTab: t }).catch(() => undefined);
  }, []);

  useEffect(() => {
    getAppPrefs()
      .then((p) => setTab(p.ashareFocusTab))
      .catch(() => undefined);
  }, []);

  const quoteMap = useMemo(() => {
    const m = new Map<string, Quote>();
    quotes.forEach((q) => m.set(rowKey(q.symbol), q));
    return m;
  }, [quotes]);

  const empty = loaded && rows.length === 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>A 股焦点</Text>
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, tab === t.key && styles.tabActive]}
              onPress={() => persistTab(t.key)}
              activeOpacity={0.75}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.list}>
        {!loaded && rows.length === 0 ? (
          <View style={styles.hintBox}>
            <Text style={styles.hint}>加载中…</Text>
          </View>
        ) : empty ? (
          <View style={styles.hintBox}>
            <Text style={styles.hint}>{err ? '数据暂不可用' : '暂无数据'}</Text>
            <TouchableOpacity onPress={() => setTick((t) => t + 1)}>
              <Text style={styles.retry}>重试</Text>
            </TouchableOpacity>
          </View>
        ) : (
          rows.map((r) => (
            <AshareQuoteRow
              key={r.key}
              symbol={r.symbol}
              name={r.name}
              sub={r.sub}
              quote={quoteMap.get(r.key)}
              fallbackPrice={r.fallbackPrice}
              fallbackPct={r.fallbackPct}
              onPress={onPressStock}
            />
          ))
        )}
      </View>
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
      marginBottom: spacing.sm,
      overflow: 'hidden',
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    title: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
    tabs: { flexDirection: 'row', gap: 4 },
    tab: {
      height: layout.chipHeight - 4,
      paddingHorizontal: spacing.sm,
      borderRadius: layout.radiusPill,
      backgroundColor: colors.surfaceAlt,
      justifyContent: 'center',
    },
    tabActive: { backgroundColor: colors.primarySoft },
    tabText: { color: colors.textSecondary, fontSize: fontSize.micro, fontWeight: '600' },
    tabTextActive: { color: colors.primary },
    list: { minHeight: 52 },
    hintBox: {
      paddingVertical: spacing.lg,
      alignItems: 'center',
      gap: spacing.xs,
    },
    hint: { color: colors.textSecondary, fontSize: fontSize.xs },
    retry: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '600' },
  });
}
