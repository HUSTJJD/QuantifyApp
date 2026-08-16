/**
 * ApiStatsScreen —— API 稳定性统计面板。
 *
 * 数据来自 MarketDataClient 自动埋点的 apiStats（进程内内存统计），
 * 用于评估各数据源“更全 / 更稳”：成功率、平均延迟、覆盖度、失败原因分布。
 *
 * 用法：在 App 内「设置 → 调试」或主页调试入口进入；可手动刷新/清零。
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiStats, type SourceStat } from '@/api/ApiStabilityStats';
import { colors, spacing, fontSize, radius } from '@/theme';

function successRate(s: SourceStat): number {
  return s.attempts ? (s.successes / s.attempts) * 100 : 0;
}
function avgLatency(s: SourceStat): number {
  return s.successes ? s.successLatencySum / s.successes : 0;
}
function coverage(s: SourceStat): { ok: number; total: number } {
  const keys = Object.keys(s.methodsOk);
  return { ok: keys.filter((k) => s.methodsOk[k]).length, total: keys.length };
}

function rateColor(rate: number): string {
  if (rate >= 99) return colors.down;
  if (rate >= 80) return '#E0A800';
  return colors.up;
}

export function ApiStatsScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [stats, setStats] = useState<SourceStat[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => setStats(apiStats.getAll()), []);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  // 面板挂载即读一次；随后每 1.5s 自动重读进程内埋点，
  // 这样用户在别处触发数据源调用时，本面板数字会实时跳动，无需手动刷新。
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, [refresh]);

  const totalAttempts = stats.reduce((a, s) => a + s.attempts, 0);
  const totalSuccess = stats.reduce((a, s) => a + s.successes, 0);
  const best = stats[0]; // 已按评分降序

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.title}>API 稳定性统计</Text>
        <TouchableOpacity onPress={refresh}>
          <Text style={styles.refresh}>刷新</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.summary}>
        <SummaryCell label="总请求" value={String(totalAttempts)} />
        <SummaryCell label="总成功" value={String(totalSuccess)} />
        <SummaryCell
          label="整体成功率"
          value={totalAttempts ? `${((totalSuccess / totalAttempts) * 100).toFixed(1)}%` : '—'}
        />
        <SummaryCell
          label="最稳源"
          value={best && best.attempts ? best.label : '—'}
          small
        />
      </View>

      <ScrollView
        style={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
        }
      >
        {stats.length === 0 && <Text style={styles.empty}>等待数据源调用…（去个股页拉一次 K 线/行情即可看到统计）</Text>}

        {stats.map((s) => {
          const rate = successRate(s);
          const lat = avgLatency(s);
          const cov = coverage(s);
          const score = apiStats.score(s);
          const reasons = Object.entries(s.failureReasons).sort((a, b) => b[1] - a[1]);
          return (
            <View key={s.id} style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>{s.label}</Text>
                <View style={[styles.badge, { backgroundColor: scoreColor(score) }]}>
                  <Text style={styles.badgeText}>{score}</Text>
                </View>
              </View>
              <Text style={styles.cardSub}>{s.id}</Text>

              <View style={styles.metricRow}>
                <Metric label="成功率" value={`${rate.toFixed(1)}%`} color={rateColor(rate)} />
                <Metric label="平均延迟" value={s.successes ? `${lat.toFixed(0)}ms` : '—'} />
                <Metric label="覆盖度" value={cov.total ? `${cov.ok}/${cov.total}` : '—'} />
                <Metric label="成功/失败" value={`${s.successes}/${s.failures}`} />
              </View>

              {s.successes > 0 && (
                <Text style={styles.latText}>最近一次成功延迟：{s.lastSuccessLatency}ms</Text>
              )}

              {reasons.length > 0 && (
                <View style={styles.reasons}>
                  <Text style={styles.reasonsTitle}>失败原因（累计）</Text>
                  {reasons.map(([r, c]) => (
                    <View key={r} style={styles.reasonRow}>
                      <Text style={styles.reasonDot} />
                      <Text style={styles.reasonText}>{r}</Text>
                      <Text style={styles.reasonCount}>×{c}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <TouchableOpacity
        style={styles.clearBtn}
        onPress={() => {
          apiStats.clear();
          refresh();
        }}
      >
        <Text style={styles.clearText}>清零统计</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

function scoreColor(score: number): string {
  if (score >= 85) return colors.down;
  if (score >= 60) return '#E0A800';
  return colors.up;
}

function SummaryCell({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <View style={styles.summaryCell}>
      <Text style={[styles.summaryValue, small && { fontSize: fontSize.sm }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { color: colors.primary, fontSize: fontSize.md, width: 60 },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '600' },
  refresh: { color: colors.primary, fontSize: fontSize.md, width: 60, textAlign: 'right' },
  summary: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryCell: { flex: 1, alignItems: 'center' },
  summaryValue: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  summaryLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  list: { flex: 1, padding: spacing.md },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  cardSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2, marginBottom: spacing.sm },
  badge: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: { color: '#fff', fontSize: fontSize.sm, fontWeight: '700' },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metric: { alignItems: 'center', flex: 1 },
  metricValue: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  metricLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  latText: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: spacing.sm },
  reasons: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  reasonsTitle: { color: colors.textSecondary, fontSize: fontSize.xs, marginBottom: spacing.xs },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 2 },
  reasonDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.up },
  reasonText: { flex: 1, color: colors.text, fontSize: fontSize.xs },
  reasonCount: { color: colors.textSecondary, fontSize: fontSize.xs },
  clearBtn: {
    margin: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  clearText: { color: colors.text, fontSize: fontSize.sm },
});
