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
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { marketData } from '@/data/api';
import { logger } from '@/utils/logger';
import type { IndexConstituent, Quote, Symbol, Valuation } from '@/data/api';
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

type SortKey = 'seq' | 'price' | 'pct' | 'pe' | 'pb';

interface Row {
  key: string;
  seq: number;
  symbol: Symbol;
  name: string;
  quote?: Quote;
  valuation?: Valuation;
  price: number | null;
  pct: number | null;
  pe: number | null;
  pb: number | null;
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '--';
  return v.toFixed(digits);
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
  const [quoteByCode, setQuoteByCode] = useState<Map<string, Quote>>(new Map());
  const [valuations, setValuations] = useState<Map<string, Valuation>>(new Map());
  const [valByCode, setValByCode] = useState<Map<string, Valuation>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('seq');
  const [sortDesc, setSortDesc] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setConstituents(null);
    setQuotes(new Map());
    setValuations(new Map());

    const tag = qkey(symbol);
    marketData
      .getIndexConstituents(symbol)
      .then(async (list) => {
        logger.debug('IndexConstituents', `${tag} 拉成分完成`, { n: list?.length ?? -1 });
        if (!alive) return;
        setConstituents(list);
        if (list.length === 0) {
          if (alive) setLoading(false);
          return;
        }
        const syms = list.map((x) => x.symbol);
        // 分片拉行情：整批上百只容易被上游限流/整包失败；估值同样分片
        const chunk = <T,>(arr: T[], n: number): T[][] => {
          const out: T[][] = [];
          for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
          return out;
        };
        const [quoteRes, valRes] = await Promise.allSettled([
          (async () => {
            const parts = await Promise.all(chunk(syms, 40).map((s) => marketData.getQuotes(s)));
            return parts.flat();
          })(),
          (async () => {
            const parts = await Promise.all(chunk(syms, 40).map((s) => marketData.getValuations(s)));
            return parts.flat();
          })(),
        ]);
        if (!alive) return;
        if (quoteRes.status === 'fulfilled') {
          // 以 code 为主键匹配，避免 exchange 写法差异导致整列空
          const byCode = new Map<string, Quote>();
          const byFull = new Map<string, Quote>();
          quoteRes.value.forEach((q) => {
            byFull.set(qkey(q.symbol), q);
            byCode.set(q.symbol.code, q);
          });
          setQuoteByCode(byCode);
          setQuotes(byFull);
          logger.debug('IndexConstituents', `${tag} 拉行情完成`, {
            n: quoteRes.value.length,
            total: list.length,
            sampleKeys: quoteRes.value.slice(0, 3).map((q) => qkey(q.symbol)),
          });
        } else {
          logger.warn('IndexConstituents', `${tag} 拉行情失败`, {
            error: String(quoteRes.reason?.message ?? quoteRes.reason),
          });
        }
        if (valRes.status === 'fulfilled') {
          const byFull = new Map<string, Valuation>();
          const byCode = new Map<string, Valuation>();
          valRes.value.forEach((v) => {
            byFull.set(qkey(v.symbol), v);
            byCode.set(v.symbol.code, v);
          });
          setValuations(byFull);
          setValByCode(byCode);
        }
        setLoading(false);
      })
      .catch((e) => {
        logger.warn('IndexConstituents', `${tag} 拉成分失败`, {
          error: String((e as Error)?.message ?? e),
        });
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [symbol, refreshKey]);

  const rows = useMemo<Row[]>(() => {
    if (!constituents) return [];
    const list: Row[] = constituents.map((item, i) => {
      const quote =
        quotes.get(qkey(item.symbol)) ?? quoteByCode.get(item.symbol.code);
      const valuation =
        valuations.get(qkey(item.symbol)) ?? valByCode.get(item.symbol.code);
      return {
        key: qkey(item.symbol),
        seq: i + 1,
        symbol: item.symbol,
        name: item.name || item.symbol.code,
        quote,
        valuation,
        price: quote && quote.last > 0 ? quote.last : null,
        pct: pctOf(quote),
        pe: valuation?.peTtm ?? null,
        pb: valuation?.pbMrq ?? null,
      };
    });
    if (sortKey === 'seq') {
      return sortDesc ? [...list].reverse() : list;
    }
    const pick = (r: Row) => {
      switch (sortKey) {
        case 'price':
          return r.price;
        case 'pct':
          return r.pct;
        case 'pe':
          return r.pe;
        case 'pb':
          return r.pb;
        default:
          return r.seq;
      }
    };
    return [...list].sort((a, b) => {
      const va = pick(a);
      const vb = pick(b);
      // null 永远沉底
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return sortDesc ? vb - va : va - vb;
    });
  }, [constituents, quotes, quoteByCode, valuations, valByCode, sortKey, sortDesc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(key === 'seq');
    }
  };

  const sortMark = (key: SortKey): string => {
    if (sortKey !== key) return '';
    return sortDesc ? '↓' : '↑';
  };

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
        <Text style={styles.headTip}>点击表头排序 · 点行看详情</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.table}>
          <View style={styles.headerRow}>
            <TouchableOpacity style={[styles.th, styles.thSeq]} onPress={() => toggleSort('seq')}>
              <Text style={styles.thText}># {sortMark('seq')}</Text>
            </TouchableOpacity>
            <View style={[styles.th, styles.thName]}>
              <Text style={styles.thText}>名称 / 代码</Text>
            </View>
            <TouchableOpacity style={[styles.th, styles.thNum]} onPress={() => toggleSort('price')}>
              <Text style={styles.thText}>现价 {sortMark('price')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.th, styles.thNum]} onPress={() => toggleSort('pct')}>
              <Text style={styles.thText}>涨跌幅 {sortMark('pct')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.th, styles.thNum]} onPress={() => toggleSort('pe')}>
              <Text style={styles.thText}>PE(TTM) {sortMark('pe')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.th, styles.thNum]} onPress={() => toggleSort('pb')}>
              <Text style={styles.thText}>PB {sortMark('pb')}</Text>
            </TouchableOpacity>
          </View>
          {rows.map((r) => {
            const col = r.pct == null ? c.textSecondary : r.pct >= 0 ? c.up : c.down;
            return (
              <TouchableOpacity
                key={r.key}
                style={styles.row}
                activeOpacity={0.6}
                onPress={() => onOpenSymbol?.(r.symbol)}
              >
                <Text style={[styles.td, styles.thSeq]}>{r.seq}</Text>
                <View style={[styles.nameCell, styles.thName]}>
                  <Text style={styles.name} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text style={styles.code}>{r.symbol.code}</Text>
                </View>
                <Text style={[styles.td, styles.thNum, styles.price]}>
                  {fmtPrice(r.quote)}
                </Text>
                <Text style={[styles.td, styles.thNum, { color: col, fontWeight: '600' }]}>
                  {r.pct == null ? '--' : `${r.pct > 0 ? '+' : ''}${r.pct.toFixed(2)}%`}
                </Text>
                <Text style={[styles.td, styles.thNum, styles.numCell]}>{fmtNum(r.pe)}</Text>
                <Text style={[styles.td, styles.thNum, styles.numCell]}>{fmtNum(r.pb)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
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
    table: { minWidth: 520 },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    th: {
      paddingVertical: spacing.xs,
      justifyContent: 'center',
    },
    thText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
    thSeq: { width: 36, textAlign: 'center' },
    thName: { width: 140, paddingRight: spacing.sm },
    thNum: { width: 88, alignItems: 'flex-end', paddingRight: spacing.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    td: {
      color: colors.text,
      fontSize: fontSize.sm,
    },
    nameCell: {
      width: 140,
      paddingRight: spacing.sm,
      justifyContent: 'center',
    },
    name: { color: colors.text, fontSize: fontSize.sm, fontWeight: '500' },
    code: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 1 },
    price: { fontWeight: fontWeight.semibold as any, textAlign: 'right' },
    numCell: { textAlign: 'right', color: colors.textSecondary },
    hint: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      textAlign: 'center',
      paddingVertical: spacing.lg,
    },
  });
}
