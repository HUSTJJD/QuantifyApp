/**
 * SectorBoard —— 首页行业板块行情速览组件（方块热力图 / treemap 版）。
 *
 * 用「方块热力图（squarified treemap）」展示全部行业板块：
 *  - 每块面积正比于板块成交额（amount），自动调节大小——大板块占大块，小板块占小块
 *  - 块内背景色按涨跌幅着色（红涨绿跌，A股习惯；强度随幅度加深）
 *  - 不按固定网格排列（那只是列表），而是用 squarify 算法把矩形铺满、尽量接近正方形
 *  - 块内显示板块名 + 涨跌幅（太小则只留色块）
 *  - 点击板块查看成分股（预留接口）
 */
import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { marketData } from '@/data/api';
import type { IndexInfo, Quote, IndexTag } from '@/data/api';
import { useQuotes } from '@/hooks/useMarketData';
import { useAppTheme } from '@/theme/ThemeProvider';
import { toFullCode } from '@/domain';
import { spacing, fontSize, radius } from '@/theme';
import { squarify, type TreemapItem } from '@/utils/treemap';

interface SectorBoardProps {
  tag?: IndexTag;
  onPress?: (index: IndexInfo) => void;
}

/** 涨跌幅达到该值即视为满色（最强强度），超过不再加深 */
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

/** 由涨跌幅计算色块配色：背景从 surface 渐变到 up/down（强度随幅度），文字按亮度取对比色 */
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
}

function mapHeight(w: number): number {
  return Math.max(280, Math.min(560, Math.round(w * 0.72)));
}

/**
 * 板块涨跌幅：优先用源直接给的 changePct。
 * 部分源（如板块 spot）只给涨跌幅、不给昨收（prevClose=0），
 * 此时若只用 (last-prevClose)/prevClose 会把所有板块算成 0%，整张图全灰。
 */
function pctOf(q?: Quote): number {
  if (!q) return 0;
  if (q.changePct != null) return q.changePct;
  return q.prevClose ? ((q.last - q.prevClose) / q.prevClose) * 100 : 0;
}

export function SectorBoard({ tag = 'industry', onPress }: SectorBoardProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const [indices, setIndices] = useState<IndexInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [size, setSize] = useState({ w: 0, h: 320 });
  const styles = makeStyles(colors);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    marketData
      .listIndices(tag)
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
  }, [tag]);

  // 把板块指数转成 Symbol 数组请求行情
  const symbols = indices.map((i) => i.symbol);
  const { data: quotes, loading: quotesLoading, reload } = useQuotes(symbols, 'index');

  // 组装每个板块：涨跌幅 + 用于决定块大小的权重（成交额，缺失回退成交量/1）
  const items = useMemo<SectorItem[]>(() => {
    const quoteMap = new Map<string, Quote>();
    (quotes ?? []).forEach((q) => quoteMap.set(toFullCode(q.symbol), q));
    return indices
      .map((idx) => {
        const q = quoteMap.get(toFullCode(idx.symbol));
        const pct = pctOf(q);
        const hasQuote = !!q && q.last > 0;
        const amount = hasQuote ? (q.amount > 0 ? q.amount : q.volume > 0 ? q.volume : 1) : 1;
        return { index: idx, pct, amount, hasQuote };
      })
      .filter((it) => it.hasQuote)
      .map(({ index, pct, amount }) => ({ index, pct, amount }));
  }, [indices, quotes]);

  const itemByKey = useMemo(() => {
    const m = new Map<string, SectorItem>();
    items.forEach((it) => m.set(toFullCode(it.index.symbol), it));
    return m;
  }, [items]);

  // 计算 treemap 布局：权重=成交额，铺满测得宽度
  const rects = useMemo(() => {
    if (size.w <= 0 || items.length === 0) return [];
    const tmItems: TreemapItem[] = items.map((it) => ({ key: toFullCode(it.index.symbol), weight: it.amount }));
    return squarify(tmItems, size.w, size.h);
  }, [items, size.w, size.h]);

  return (
    // 宽度在容器上测量：map 只在有数据时渲染，若把 onLayout 挂在 map 上会形成
    // “没有宽度 → 不出 rects → 不渲染 map → 测不到宽度”的死锁，页面永远停在空状态。
    <View
      style={styles.container}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && w !== size.w) setSize({ w, h: mapHeight(w) });
      }}
    >
      <View style={styles.header}>
        <Text style={styles.title}>行业板块</Text>
        <View style={styles.legend}>
          <View style={[styles.legendSwatch, { backgroundColor: colors.down }]} />
          <Text style={styles.legendText}>跌</Text>
          <View style={[styles.legendSwatch, { backgroundColor: colors.surface }]} />
          <Text style={styles.legendText}>平</Text>
          <View style={[styles.legendSwatch, { backgroundColor: colors.up }]} />
          <Text style={styles.legendText}>涨</Text>
          <Text style={[styles.legendText, { marginLeft: 6 }]}>· 块大小=成交额</Text>
        </View>
      </View>

      {loading ? (
        <View style={[styles.loading, { height: size.h }]}>
          <Text style={styles.loadingText}>加载中…</Text>
        </View>
      ) : indices.length === 0 ? (
        <View style={[styles.loading, { height: size.h }]}>
          <Text style={styles.loadingText}>暂无板块数据</Text>
        </View>
      ) : items.length === 0 ? (
        // 列表已拿到但行情没取到：给可点的重试，而不是一句无法行动的“暂无数据”
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
                    <Text style={[styles.tilePct, { color: fg }]}>
                      {it.pct >= 0 ? '+' : ''}
                      {it.pct.toFixed(2)}%
                    </Text>
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
    container: {
      marginBottom: spacing.md,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      paddingHorizontal: spacing.md,
      marginBottom: spacing.sm,
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
