/**
 * IndexConstituentsPanel —— 指数 / 行业板块详情页的「成分股」面板。
 *
 * 数据流程：
 *  1) marketData.getIndexConstituents(symbol) 拉成分（仅 symbol + name）；
 *  2) 再对成分 symbol 批量 marketData.getQuotes 拉实时行情（自动按指数/个股分流；
 *     行情失败不阻塞列表，仅价格显示 '--'）；
 *  3) 点击任一行回调 onOpenSymbol，供上层 push 到对应个股详情。
 *
 * 页面下拉刷新时由 StockDetailScreen 递增 refreshKey 触发本面板重新拉取。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { marketData } from '@/data/api';
import type { IndexConstituent, Quote, Symbol } from '@/data/api';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, fontWeight } from '@/theme';

function qkey(s: Symbol): string {
  return `${s.code}.${s.exchange}`;
}

function fmtPrice(q: Quote | undefined): string {
  return q && q.last > 0 ? q.last.toFixed(2) : '--';
}

/** 涨跌幅（changePct 优先；缺失则由 change/prevClose 兜底推算） */
function pctOf(q: Quote | undefined): number | null {
  if (!q) return null;
  if (q.changePct != null) return q.changePct;
  if (q.prevClose > 0 && q.change != null) return (q.change / q.prevClose) * 100;
  return null;
}

export function IndexConstituentsPanel({
  symbol,
  refreshKey,
  onOpenSymbol,
}: {
  symbol: Symbol;
  /** 页面下拉刷新计数：变化时重新拉成分与行情 */
  refreshKey: number;
  onOpenSymbol?: (s: Symbol) => void;
}): React.JSX.Element {
  const { colors: c } = useAppTheme();
  const styles = makeStyles(c);
  const [constituents, setConstituents] = useState<IndexConstituent[] | null>(null);
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setConstituents(null);
    setQuotes(new Map());

    const tag = qkey(symbol);
    // TODO(debug): 临时探针，定位成分股拉取失败，定位后删除
    marketData
      .getIndexConstituents(symbol)
      .then(async (list) => {
        console.warn(`[constituent-debug] ${tag} 拉成分完成 n=${list?.length ?? -1}`);
        if (!alive) return;
        setConstituents(list);
        if (list.length === 0) {
          if (alive) setLoading(false);
          return;
        }
        // 行情失败不阻塞列表展示（此时价格列显示 '--'）
        try {
          const data = await marketData.getQuotes(list.map((x) => x.symbol));
          console.warn(`[constituent-debug] ${tag} 拉行情完成 n=${data?.length ?? -1} / 成分 ${list.length}`);
          const m = new Map<string, Quote>();
          (data ?? []).forEach((q) => m.set(qkey(q.symbol), q));
          if (alive) setQuotes(m);
        } catch (ee) {
          console.warn(`[constituent-debug] ${tag} 拉行情失败: ${String((ee as Error)?.message ?? ee)}`);
          /* 忽略：保留仅有名称的列表 */
        } finally {
          if (alive) setLoading(false);
        }
      })
      .catch((e) => {
        console.warn(`[constituent-debug] ${tag} 拉成分失败: ${String((e as Error)?.message ?? e)}`);
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [symbol, refreshKey]);

  if (loading) {
    return <Text style={styles.hint}>成分股加载中…</Text>;
  }
  if (error) {
    return <Text style={styles.hint}>成分股加载失败：{error}</Text>;
  }
  if (!constituents || constituents.length === 0) {
    return <Text style={styles.hint}>该标的暂无成分股数据</Text>;
  }

  return (
    <View style={styles.panel}>
      <View style={styles.headRow}>
        <Text style={styles.headCount}>共 {constituents.length} 只</Text>
        <Text style={styles.headTip}>点击可查看个股详情</Text>
      </View>
      {constituents.map((item, i) => {
        const q = quotes.get(qkey(item.symbol));
        const pct = pctOf(q);
        const col = pct == null ? c.textSecondary : pct >= 0 ? c.up : c.down;
        return (
          <TouchableOpacity
            key={qkey(item.symbol)}
            style={styles.row}
            activeOpacity={0.6}
            onPress={() => onOpenSymbol?.(item.symbol)}
          >
            <Text style={styles.seq}>{i + 1}</Text>
            <View style={styles.nameBox}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name || item.symbol.code}
              </Text>
              <Text style={styles.code}>{item.symbol.code}</Text>
            </View>
            <View style={styles.rightBox}>
              <Text style={styles.price}>{fmtPrice(q)}</Text>
              <Text style={[styles.pct, { color: col }]}>
                {pct == null
                  ? '--'
                  : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    panel: {
      marginHorizontal: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: spacing.sm,
      paddingBottom: spacing.xs,
    },
    headRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.xs,
    },
    headCount: { color: colors.textSecondary, fontSize: fontSize.xs },
    headTip: { color: colors.textSecondary, fontSize: fontSize.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    seq: { width: 28, color: colors.textSecondary, fontSize: fontSize.xs },
    nameBox: { flex: 1, marginRight: spacing.sm },
    name: { color: colors.text, fontSize: fontSize.sm, fontWeight: '500' },
    code: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 1 },
    rightBox: { alignItems: 'flex-end' },
    price: { color: colors.text, fontSize: fontSize.sm, fontWeight: fontWeight.semibold as any },
    pct: { fontSize: fontSize.xs, marginTop: 2, fontWeight: '600' },
    hint: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center', paddingVertical: spacing.lg },
  });
}
