/**
 * SectorBoard —— 首页板块热力图（行业/概念可切换，颜色指标可切换）。
 * 参考 stock-dashboard Heatmap：维度 + 颜色指标 + 块大小=成交额。
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { marketData } from '@/data/api';
import type { IndexInfo, Quote, IndexTag } from '@/data/api';
import { useQuotes } from '@/hooks/useMarketData';
import { useAppTheme } from '@/theme/ThemeProvider';
import { toFullCode } from '@/domain';
import { spacing, fontSize, radius, layout } from '@/theme';
import { squarify, type TreemapItem } from '@/utils/treemap';
import { getAppPrefs, setAppPrefs, type AppPrefs } from '@/settings/appPrefs';
import { Skeleton } from '@/components/ui/Skeleton';

type HeatMetric = AppPrefs['heatmapMetric'];

interface SectorBoardProps {
  tag?: IndexTag;
  onPress?: (index: IndexInfo) => void;
}

const FULL_COLOR_PCT = 5;

interface Rgb { r: number; g: number; b: number }

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function rgbStr(c: Rgb): string {
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}

function heatColor(pct: number, surface: string, up: string, down: string): { bg: string; fg: string } {
  const mag = Math.min(Math.abs(pct) / FULL_COLOR_PCT, 1);
  const base = hexToRgb(surface);
  const target = hexToRgb(pct >= 0 ? up : down);
  const c = mix(base, target, mag);
  const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  return { bg: rgbStr(c), fg: lum > 0.6 ? '#1A1F29' : '#FFFFFF' };
}

interface SectorItem {
  index: IndexInfo;
  pct: number;
  amount: number;
  volume: number;
}

function mapHeight(w: number): number {
  return Math.max(280, Math.min(560, Math.round(w * 0.72)));
}

function pctOf(q?: Quote): number {
  if (!q) return 0;
  if (q.changePct != null) return q.changePct;
  return q.prevClose ? ((q.last - q.prevClose) / q.prevClose) * 100 : 0;
}

const DIM_OPTIONS: Array<{ key: 'industry' | 'cn_concept'; label: string }> = [
  { key: 'industry', label: '行业' },
  { key: 'cn_concept', label: '概念' },
];
const METRIC_OPTIONS: Array<{ key: HeatMetric; label: string }> = [
  { key: 'pct', label: '涨跌' },
  { key: 'amount', label: '成交额' },
  { key: 'volume', label: '成交量' },
];

export function SectorBoard({ tag, onPress }: SectorBoardProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const [dim, setDim] = useState<'industry' | 'cn_concept'>('industry');
  const [metric, setMetric] = useState<HeatMetric>('pct');
  const [indices, setIndices] = useState<IndexInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [size, setSize] = useState({ w: 0, h: 320 });
  const styles = makeStyles(colors);

  const activeTag: IndexTag = tag ?? dim;

  useEffect(() => {
    getAppPrefs()
      .then((p) => {
        setDim(p.heatmapTag);
        setMetric(p.heatmapMetric);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    marketData
      .listIndices(activeTag)
      .then((data) => {
        if (mounted) setIndices(data);
      })
      .catch(() => {
        if (mounted) setIndices([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [activeTag]);

  const symbols = indices.map((i) => i.symbol);
  const { data: quotes, loading: quotesLoading, reload } = useQuotes(symbols, 'index');

  const items = useMemo<SectorItem[]>(() => {
    const quoteMap = new Map<string, Quote>();
    (quotes ?? []).forEach((q) => quoteMap.set(toFullCode(q.symbol), q));
    return indices
      .map((idx) => {
        const q = quoteMap.get(toFullCode(idx.symbol));
        const pct = pctOf(q);
        const hasQuote = !!q && q.last > 0;
        const amount = hasQuote ? (q.amount > 0 ? q.amount : q.volume > 0 ? q.volume : 1) : 1;
        const volume = hasQuote ? (q.volume > 0 ? q.volume : 1) : 1;
        return { index: idx, pct, amount, volume, hasQuote };
      })
      .filter((it) => it.hasQuote)
      .map(({ index, pct, amount, volume }) => ({ index, pct, amount, volume }));
  }, [indices, quotes]);

  const itemByKey = useMemo(() => {
    const m = new Map<string, SectorItem>();
    items.forEach((it) => m.set(toFullCode(it.index.symbol), it));
    return m;
  }, [items]);

  const rects = useMemo(() => {
    if (size.w <= 0 || items.length === 0) return [];
    const tmItems: TreemapItem[] = items.map((it) => ({
      key: toFullCode(it.index.symbol),
      weight: it.amount,
    }));
    return squarify(tmItems, size.w, size.h);
  }, [items, size.w, size.h]);

  const persistDim = useCallback((d: 'industry' | 'cn_concept') => {
    setDim(d);
    setAppPrefs({ heatmapTag: d }).catch(() => undefined);
  }, []);
  const persistMetric = useCallback((m: HeatMetric) => {
    setMetric(m);
    setAppPrefs({ heatmapMetric: m }).catch(() => undefined);
  }, []);

  return (
    <View
      style={styles.container}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && w !== size.w) setSize({ w, h: mapHeight(w) });
      }}
    >
      <View style={styles.header}>
        <Text style={styles.title}>板块热力</Text>
        <View style={styles.legend}>
          <View style={[styles.legendSwatch, { backgroundColor: colors.down }]} />
          <Text style={styles.legendText}>跌</Text>
          <View style={[styles.legendSwatch, { backgroundColor: colors.surface }]} />
          <Text style={styles.legendText}>平</Text>
          <View style={[styles.legendSwatch, { backgroundColor: colors.up }]} />
          <Text style={styles.legendText}>涨</Text>
        </View>
      </View>

      {/* 维度 + 颜色指标 */}
      <View style={styles.chipRow}>
        {DIM_OPTIONS.map((o) => (
          <TouchableOpacity
            key={o.key}
            style={[styles.chip, dim === o.key && styles.chipActive]}
            onPress={() => persistDim(o.key)}
            activeOpacity={0.75}
          >
            <Text style={[styles.chipText, dim === o.key && styles.chipTextActive]}>{o.label}</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.chipSpacer} />
        {METRIC_OPTIONS.map((o) => (
          <TouchableOpacity
            key={o.key}
            style={[styles.chip, metric === o.key && styles.chipActiveSoft]}
            onPress={() => persistMetric(o.key)}
            activeOpacity={0.75}
          >
            <Text style={[styles.chipText, metric === o.key && styles.chipTextPrimary]}>{o.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <Skeleton shape="chart" height={size.h || 280} style={{ marginTop: spacing.sm }} />
      ) : indices.length === 0 ? (
        <View style={[styles.loading, { height: size.h }]}>
          <Text style={styles.loadingText}>暂无板块数据</Text>
        </View>
      ) : items.length === 0 ? (
        <TouchableOpacity
          style={[styles.loading, { height: size.h }]}
          onPress={reload}
          activeOpacity={0.7}
        >
          <Text style={styles.loadingText}>
            {quotesLoading ? '板块行情加载中…' : '板块行情暂不可用，点击重试'}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.map, { height: size.h }]}>
          {rects.map((r) => {
            const key = r.key as string;
            const it = itemByKey.get(key);
            if (!it) return null;
            const { bg, fg } = heatColor(it.pct, colors.surface, colors.up, colors.down);
            const showText = r.width >= 42 && r.height >= 30;
            const metricLabel =
              metric === 'pct'
                ? `${it.pct >= 0 ? '+' : ''}${it.pct.toFixed(2)}%`
                : metric === 'amount'
                  ? `${(it.amount / 1e8).toFixed(1)}亿`
                  : `${(it.volume / 1e4).toFixed(0)}万`;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.tile, { left: r.x, top: r.y, width: r.width, height: r.height, backgroundColor: bg }]}
                onPress={() => onPress?.(it.index)}
                activeOpacity={0.7}
              >
                {showText && (
                  <View style={styles.tileInner}>
                    <Text style={[styles.tileName, { color: fg }]} numberOfLines={2}>
                      {it.index.name}
                    </Text>
                    <Text style={[styles.tilePct, { color: fg }]}>{metricLabel}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: { marginBottom: spacing.md },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      paddingHorizontal: spacing.xs,
      marginBottom: spacing.xs,
      gap: spacing.xs,
    },
    title: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    legend: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    legendSwatch: {
      width: 12,
      height: 12,
      borderRadius: 3,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    legendText: {
      color: colors.textSecondary,
      fontSize: fontSize.xs,
      marginRight: 3,
    },
    chipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginBottom: spacing.sm,
      flexWrap: 'wrap',
    },
    chipSpacer: { width: spacing.sm },
    chip: {
      height: layout.chipHeight,
      paddingHorizontal: spacing.md,
      borderRadius: layout.radiusPill,
      backgroundColor: colors.surfaceAlt,
      justifyContent: 'center',
    },
    chipActive: { backgroundColor: colors.primary },
    chipActiveSoft: { backgroundColor: colors.primarySoft },
    chipText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
    chipTextActive: { color: '#fff' },
    chipTextPrimary: { color: colors.primary },
    map: {
      width: '100%',
      position: 'relative',
    },
    tile: {
      position: 'absolute',
      borderRadius: radius.sm,
      padding: 4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(0,0,0,0.18)',
      overflow: 'hidden',
    },
    tileInner: {
      flex: 1,
      justifyContent: 'center',
    },
    tileName: {
      fontSize: fontSize.xs,
      fontWeight: '600',
      lineHeight: 14,
      marginBottom: 2,
    },
    tilePct: {
      fontSize: fontSize.xs,
      fontWeight: '700',
    },
    loading: {
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    loadingText: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
  });
}
