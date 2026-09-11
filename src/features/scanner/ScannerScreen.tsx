/**
 * 全市场扫描选股页：基于本地量化库遍历全部标的，按指标条件筛选候选股。
 *
 * 条件（可组合）：
 *  - MACD 金叉
 *  - 均线多头排列（MA5 > MA10 > MA20）
 *  - RSI 区间（默认过滤超买超卖）
 *  - 最小涨幅
 *
 * 数据源：本地 tickers + 不复权日 K（无网络请求）；首次使用需先同步标的库。
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scanMarket, ScanHit, ScanProgress } from '@/quant/scanner';
import { spacing, fontSize, radius } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';
import type { Symbol } from '@/data/api';
import { addToWatchlist } from '@/data/repositories/WatchlistRepository';
import { hitKey, addHitsToWatchlist, saveScanSnapshot } from './scanActions';

const CRITERIA = [
  { key: 'macdGoldenCross' as const, label: 'MACD 金叉' },
  { key: 'maBullish' as const, label: '均线多头' },
];

export function ScannerScreen({
  onBack,
  onOpenDetail,
}: {
  onBack?: () => void;
  onOpenDetail?: (symbol: Symbol) => void;
}): React.JSX.Element {
  const { colors: c } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ macdGoldenCross: true });
  const [hits, setHits] = useState<ScanHit[]>([]);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const toggle = useCallback((key: string) => {
    setEnabled((e) => ({ ...e, [key]: !e[key] }));
  }, []);

  const addOne = useCallback(async (symbol: Symbol) => {
    await addToWatchlist(symbol);
    setAdded((prev) => {
      const next = new Set(prev);
      next.add(`${symbol.code}.${symbol.exchange}`);
      return next;
    });
  }, []);

  const addAll = useCallback(async () => {
    await addHitsToWatchlist(hits, addToWatchlist);
    setAdded(new Set(hits.map((h) => hitKey(h))));
  }, [hits]);

  const onScan = useCallback(async () => {
    setRunning(true);
    setError(null);
    setHits([]);
    setProgress(null);
    try {
      const criteria: { macdGoldenCross?: boolean; maBullish?: boolean; rsiRange?: { min: number; max: number }; minGainPct?: number } = {};
      if (enabled.macdGoldenCross) criteria.macdGoldenCross = true;
      if (enabled.maBullish) criteria.maBullish = true;
      // 默认 RSI 过滤超买超卖
      criteria.rsiRange = { min: 20, max: 80 };
      const res = await scanMarket(criteria, (p) => setProgress({ ...p }), 100);
      setHits(res.hits);
      setDuration(res.durationMs);
      // 持久化扫描快照（候选池），供工作流页回看
      saveScanSnapshot(criteria, res.hits, res.total, res.durationMs).catch(() => {});
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setRunning(false);
    }
  }, [enabled]);

  const styles = makeStyles(c);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name={Icons.chevronRight} size={24} color={c.text} style={{ transform: [{ rotate: '180deg' }] }} />
        </TouchableOpacity>
        <Text style={styles.title}>全市场扫描</Text>
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.hint}>基于本地量化库遍历全部标的（无网络请求）。首次使用请先在设置页执行「立即同步」。</Text>

        <Text style={styles.sectionTitle}>筛选条件</Text>
        <View style={styles.criteriaRow}>
          {CRITERIA.map((crit) => (
            <TouchableOpacity
              key={crit.key}
              style={[styles.chip, enabled[crit.key] && styles.chipOn]}
              onPress={() => toggle(crit.key)}
            >
              <Text style={[styles.chipText, enabled[crit.key] && styles.chipTextOn]}>{crit.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.chip, enabled.rsiRange && styles.chipOn]} onPress={() => toggle('rsiRange')}>
            <Text style={[styles.chipText, enabled.rsiRange && styles.chipTextOn]}>RSI 过滤</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={[styles.scanBtn, running && styles.scanBtnDisabled]} onPress={onScan} disabled={running}>
          <Text style={styles.scanBtnText}>{running ? '扫描中…' : '开始扫描'}</Text>
        </TouchableOpacity>

        {progress && running && (
          <Text style={styles.progress}>
            进度 {progress.done}/{progress.total} · 命中 {progress.hits}
          </Text>
        )}
        {!running && duration > 0 && <Text style={styles.progress}>耗时 {Math.round(duration / 1000)}s · 命中 {hits.length}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.resultHeaderRow}>
          <Text style={styles.sectionTitle}>结果（{hits.length}）</Text>
          {hits.length > 0 && (
            <TouchableOpacity
              style={styles.bulkBtn}
              onPress={addAll}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Icon name={Icons.plus} size={16} color={c.primary} />
              <Text style={styles.bulkBtnText}>全部加入自选</Text>
            </TouchableOpacity>
          )}
        </View>
        {hits.map((h, i) => {
          const isAdded = added.has(hitKey(h));
          return (
            <View key={`${h.symbol.code}-${i}`} style={styles.hitRow}>
              <View style={styles.hitLeft}>
                <Text style={styles.hitName}>{h.name || h.symbol.code}</Text>
                <Text style={styles.hitCode}>{h.symbol.exchange}.{h.symbol.code}</Text>
              </View>
              <View style={styles.hitRight}>
                <Text style={styles.hitReasons}>{h.reasons.join(' · ')}</Text>
                <Text style={styles.hitClose}>收盘 {h.lastClose.toFixed(2)}{h.changePct != null ? `（${h.changePct >= 0 ? '+' : ''}${h.changePct.toFixed(2)}%）` : ''}</Text>
              </View>
              <View style={styles.hitActions}>
                <TouchableOpacity
                  onPress={() => onOpenDetail?.(h.symbol)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.actionBtn}
                  accessibilityLabel="查看详情"
                >
                  <Icon name={Icons.chevronRight} size={20} color={c.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => addOne(h.symbol)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.actionBtn}
                  accessibilityLabel={isAdded ? '已加入自选' : '加入自选'}
                >
                  <Icon name={isAdded ? Icons.star : Icons.starOutline} size={20} color={isAdded ? c.primary : c.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
        {!running && hits.length === 0 && !error && <Text style={styles.empty}>暂无命中（需先同步本地库）</Text>}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    container: { flex: 1, padding: spacing.md },
    scrollContent: { paddingBottom: 24 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    backBtn: { paddingRight: spacing.sm },
    title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
    hint: { color: colors.textSecondary, fontSize: fontSize.xs, marginBottom: spacing.md },
    sectionTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.sm },
    criteriaRow: { flexDirection: 'row', flexWrap: 'wrap' },
    chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, marginRight: spacing.xs, marginBottom: spacing.xs },
    chipOn: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
    chipText: { color: colors.textSecondary, fontSize: fontSize.sm },
    chipTextOn: { color: colors.primary, fontWeight: '600' },
    scanBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm },
    scanBtnDisabled: { opacity: 0.5 },
    scanBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
    progress: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: spacing.sm },
    error: { color: colors.down, fontSize: fontSize.sm, marginTop: spacing.sm },
    hitRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    hitLeft: { flex: 1 },
    hitName: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
    hitCode: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    hitRight: { flex: 1, alignItems: 'flex-end' },
    hitReasons: { color: colors.up, fontSize: fontSize.xs, fontWeight: '600' },
    hitClose: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    empty: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.lg, textAlign: 'center' },
    resultHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    bulkBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary },
    bulkBtnText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '600', marginLeft: 4 },
    hitActions: { flexDirection: 'row', alignItems: 'center', marginLeft: spacing.sm },
    actionBtn: { padding: 2, marginLeft: spacing.xs },
  });
}
