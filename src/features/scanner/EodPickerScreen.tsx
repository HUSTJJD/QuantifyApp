/**
 * 尾盘选股套餐与卡片流页。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, fontWeight, radius, layout } from '@/theme';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChangePct } from '@/components/ui/PriceText';
import { scanMarket, type ScanHit } from '@/quant/scanner';
import { addToWatchlist } from '@/data/repositories/WatchlistRepository';
import { saveScanSnapshot, hitKey } from './scanActions';
import { setAddedPrice } from '@/features/watchlist/addedPriceCache';
import { registerJobKind, type ScheduledJob, type JobRun } from '@/quant/scheduler';
import { sendNotify } from '@/features/notify/channels';
import { useQuotes } from '@/hooks/useMarketData';
import { displaySymbol, toFullCode } from '@/domain';
import type { Symbol, Quote } from '@/data/api';

export type EodPresetId = 'volume_breakout' | 'golden_confirm' | 'pullback_ma';

export interface EodPreset {
  id: EodPresetId;
  label: string;
  desc: string;
  criteria: {
    macdGoldenCross?: boolean;
    maBullish?: boolean;
    rsiRange?: { min: number; max: number };
    minGainPct?: number;
  };
}

export const EOD_PRESETS: EodPreset[] = [
  {
    id: 'volume_breakout',
    label: '放量突破',
    desc: '涨幅 1%~7% · RSI 20~70',
    criteria: { minGainPct: 1, rsiRange: { min: 20, max: 70 } },
  },
  {
    id: 'golden_confirm',
    label: '金叉确认',
    desc: 'MACD 金叉 · RSI 20~70',
    criteria: { macdGoldenCross: true, rsiRange: { min: 20, max: 70 } },
  },
  {
    id: 'pullback_ma',
    label: '均线多头',
    desc: 'MA5>MA10>MA20 · RSI 20~80',
    criteria: { maBullish: true, rsiRange: { min: 20, max: 80 } },
  },
];

export function EodPickerScreen({
  onBack,
  onOpenDetail,
  initialPreset,
  extraCriteria,
}: {
  onBack?: () => void;
  onOpenDetail?: (symbol: Symbol) => void;
  /** NL 入口预选套餐 */
  initialPreset?: EodPresetId;
  /** NL 额外条件（并入套餐 criteria） */
  extraCriteria?: Record<string, number | boolean>;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [presetId, setPresetId] = useState<EodPresetId>(initialPreset ?? 'volume_breakout');
  const [running, setRunning] = useState(false);
  const [hits, setHits] = useState<ScanHit[]>([]);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const styles = makeStyles(colors);

  const preset = useMemo(() => EOD_PRESETS.find((p) => p.id === presetId) ?? EOD_PRESETS[0], [presetId]);
  const symbols = useMemo(
    () => hits.filter((h) => !ignored.has(hitKey(h))).map((h) => h.symbol),
    [hits, ignored],
  );
  const { data: quotes } = useQuotes(symbols, 'stock', focused && symbols.length > 0);

  const quoteByKey = useMemo(() => {
    const m = new Map<string, Quote>();
    (quotes ?? []).forEach((q) => m.set(toFullCode(q.symbol), q));
    return m;
  }, [quotes]);

  const onScan = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const criteria = { ...preset.criteria, ...(extraCriteria ?? {}) };
      const res = await scanMarket(criteria, undefined, 50);
      setHits(res.hits);
      setDurationMs(res.durationMs);
      saveScanSnapshot({ ...criteria, source: 'eod' } as never, res.hits, res.total, res.durationMs).catch(
        () => undefined,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [preset, extraCriteria]);

  const addOne = useCallback(async (symbol: Symbol) => {
    await addToWatchlist(symbol);
    const q = quoteByKey.get(toFullCode(symbol));
    if (q?.last && q.last > 0) setAddedPrice(toFullCode(symbol), q.last);
    setAdded((prev) => new Set(prev).add(`${symbol.code}.${symbol.exchange}`));
  }, [quoteByKey]);

  const visible = hits.filter((h) => !ignored.has(hitKey(h)));

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} hitSlop={8} style={styles.back}>
            <Icon name={Icons.chevronRight} size="lg" color="primary" style={{ transform: [{ rotate: '180deg' }] }} />
          </TouchableOpacity>
        ) : (
          <View style={styles.back} />
        )}
        <Text style={styles.title}>尾盘选股</Text>
        <TouchableOpacity onPress={onScan} disabled={running} hitSlop={8} style={styles.back}>
          <Icon name={Icons.refresh} size="md" color="primary" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        refreshControl={
          <RefreshControl refreshing={running} onRefresh={onScan} colors={[colors.primary]} tintColor={colors.primary} />
        }
      >
        <Text style={styles.hint}>收盘前 14:20–14:50 扫描最有效。套餐可组合本地指标条件。</Text>

        <View style={styles.chipRow}>
          {EOD_PRESETS.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.chip, presetId === p.id && styles.chipOn]}
              onPress={() => setPresetId(p.id)}
              activeOpacity={0.75}
            >
              <Text style={[styles.chipText, presetId === p.id && styles.chipTextOn]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.presetDesc}>{preset.desc}</Text>

        <TouchableOpacity style={styles.scanBtn} onPress={onScan} disabled={running} activeOpacity={0.85}>
          <Text style={styles.scanBtnText}>{running ? '扫描中…' : '开始扫描'}</Text>
        </TouchableOpacity>

        {error ? <Text style={styles.err}>{error}</Text> : null}
        {running && hits.length === 0 ? <SkeletonRows rows={4} style={{ marginTop: spacing.md }} /> : null}

        {!running && hits.length === 0 && !error ? (
          <EmptyState
            text="点击开始扫描"
            hint="本地全市场日 K 条件筛选，结果写入候选池快照"
            icon={Icons.search}
          />
        ) : null}

        {visible.map((h) => {
          const key = hitKey(h);
          const q = quoteByKey.get(`${h.symbol.code}.${h.symbol.exchange}`);
          const pct =
            q && q.prevClose ? ((q.last - q.prevClose) / q.prevClose) * 100 : h.changePct ?? 0;
          return (
            <Card key={key} style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {displaySymbol(h.symbol, h.symbol.name)}
                </Text>
                <ChangePct pct={pct} />
              </View>
              <View style={styles.tagRow}>
                {(h.reasons ?? [preset.label]).slice(0, 3).map((r, i) => (
                  <View key={i} style={[styles.tag, { backgroundColor: colors.primarySoft }]}>
                    <Text style={[styles.tagText, { color: colors.primary }]}>{r}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.act, added.has(key) && { opacity: 0.5 }]}
                  onPress={() => addOne(h.symbol)}
                  disabled={added.has(key)}
                >
                  <Text style={[styles.actText, { color: colors.primary }]}>
                    {added.has(key) ? '已加自选' : '加自选'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.act} onPress={() => setIgnored((s) => new Set(s).add(key))}>
                  <Text style={[styles.actText, { color: colors.textSecondary }]}>忽略</Text>
                </TouchableOpacity>
                {onOpenDetail && (
                  <TouchableOpacity style={styles.act} onPress={() => onOpenDetail(h.symbol)}>
                    <Text style={[styles.actText, { color: colors.primary }]}>详情</Text>
                  </TouchableOpacity>
                )}
              </View>
            </Card>
          );
        })}

        {durationMs > 0 ? (
          <Text style={styles.meta}>扫描耗时 {(durationMs / 1000).toFixed(1)}s · 命中 {visible.length}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 48,
      paddingHorizontal: spacing.sm,
    },
    back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    title: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold as any },
    content: { padding: spacing.md },
    hint: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 16, marginBottom: spacing.md },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xs },
    chip: {
      height: layout.chipHeight,
      paddingHorizontal: spacing.md,
      borderRadius: layout.radiusPill,
      backgroundColor: colors.surfaceAlt,
      justifyContent: 'center',
    },
    chipOn: { backgroundColor: colors.primary },
    chipText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
    chipTextOn: { color: '#fff' },
    presetDesc: { color: colors.textSecondary, fontSize: fontSize.xs, marginBottom: spacing.md },
    scanBtn: {
      height: 44,
      borderRadius: radius.lg,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
    },
    scanBtnText: { color: '#fff', fontWeight: '700', fontSize: fontSize.md },
    err: { color: colors.down, fontSize: fontSize.sm, marginBottom: spacing.sm },
    card: { marginBottom: spacing.sm },
    cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    cardName: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', flex: 1 },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
    tag: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
    tagText: { fontSize: fontSize.xs, fontWeight: '600' },
    actions: {
      flexDirection: 'row',
      marginTop: spacing.md,
      gap: spacing.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: spacing.sm,
    },
    act: { paddingVertical: spacing.xs },
    actText: { fontSize: fontSize.sm, fontWeight: '600' },
    meta: { color: colors.textSecondary, fontSize: fontSize.xs, textAlign: 'center', marginTop: spacing.sm },
  });
}

/** 供调度器复用的无 UI 扫描 */
export async function runEodScanJob(presetId: EodPresetId = 'volume_breakout'): Promise<{ summary: string; hits: ScanHit[] }> {
  const preset = EOD_PRESETS.find((p) => p.id === presetId) ?? EOD_PRESETS[0];
  const res = await scanMarket(preset.criteria, undefined, 50);
  await saveScanSnapshot({ ...preset.criteria, source: 'eod' } as never, res.hits, res.total, res.durationMs);
  const top = res.hits
    .slice(0, 3)
    .map((h) => h.name || h.symbol.name || h.symbol.code)
    .join('、');
  return {
    summary: res.hits.length > 0 ? `尾盘命中 ${res.hits.length} · Top: ${top}` : '尾盘扫描完成，无命中',
    hits: res.hits,
  };
}

registerJobKind('eod_scan', async (job: ScheduledJob, _run: JobRun) => {
  const presetId = (job.payload?.preset as EodPresetId) || 'volume_breakout';
  const { summary, hits } = await runEodScanJob(presetId);
  if (hits.length > 0) {
    await sendNotify({ title: '尾盘扫描完成', body: summary, data: { kind: 'eod_scan', hits: hits.length } });
  }
  return { summary };
});
