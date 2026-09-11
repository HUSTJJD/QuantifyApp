/**
 * 行情源统计页（原「API 稳定性统计」）。
 *
 * 说明：
 *  - 本页是纯观察面板：数字来自行情请求过程中封装层（SourceRouter/apiStats）自动埋点，
 *    页面自身不发起任何行情请求、不增加请求负担；
 *  - 数据源覆盖日常调用各源：请求量 / 成功率 / 平均延迟 / 覆盖栏目 / 失败原因；
 *  - 每个源提供「单源测试」入口：基于封装方法对该源做一次真实冒烟（会真实发请求）。
 */
import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiStats, type SourceStat } from '@/data/api/ApiStabilityStats';
import { marketData } from '@/data/api';
import type { DataSourceMethod } from '@/data/api';
import { colors, spacing, fontSize, radius } from '@/theme';
import { ALL_METHODS } from '@/data/api/contract/catalog';

function successRate(s: SourceStat): number {
  return s.attempts ? (s.successes / s.attempts) * 100 : 0;
}
function avgLatency(s: SourceStat): number {
  return s.successes ? s.successLatencySum / s.successes : 0;
}

export function ApiStatsScreen({
  onBack,
  onOpenTest,
}: {
  onBack: () => void;
  onOpenTest?: (sourceId: string) => void;
}): React.JSX.Element {
  const [stats, setStats] = useState<SourceStat[]>([]);
  const [registered, setRegistered] = useState<{ id: string; label: string }[]>([]);

  const refresh = useCallback(() => {
    setStats(apiStats.getAll());
    setRegistered(marketData.listSources());
  }, []);

  // 纯内存读取：1.5s 轮询即可反映日常调用产生的埋点，页面不请求任何数据
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, [refresh]);

  const statById = new Map(stats.map((s) => [s.id, s]));
  const extraStatIds = stats.filter((s) => !registered.some((r) => r.id === s.id)).map((s) => s.id);

  // 卡片顺序：注册源（未调用也展示）→ 仅埋点出现的源
  const cards: { id: string; label: string; stat?: SourceStat }[] = [
    ...registered.map((r) => ({ id: r.id, label: r.label, stat: statById.get(r.id) })),
    ...extraStatIds.map((id) => ({ id, label: statById.get(id)!.label, stat: statById.get(id) })),
  ];

  const totalAttempts = stats.reduce((a, s) => a + s.attempts, 0);
  const totalSuccess = stats.reduce((a, s) => a + s.successes, 0);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.back}>‹ 返回</Text>
        </TouchableOpacity>
        <View style={styles.headerMid}>
          <Text style={styles.title}>行情源统计</Text>
          <Text style={styles.headerHint}>自动埋点 · 不主动发请求</Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            apiStats.clear();
            refresh();
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.clear}>清零</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.note}>
        <Text style={styles.noteText}>
          统计来自行情请求过程中自动埋点的真实调用，本页不会主动发起任何请求。手动单源测试会产生真实请求。
        </Text>
      </View>

      <View style={styles.summary}>
        <SummaryCell label="行情源" value={String(cards.length)} />
        <SummaryCell label="已调用源" value={String(stats.length)} />
        <SummaryCell label="总请求" value={String(totalAttempts)} />
        <SummaryCell
          label="成功率"
          value={totalAttempts ? `${((totalSuccess / totalAttempts) * 100).toFixed(1)}%` : '—'}
        />
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {cards.length === 0 && (
          <Text style={styles.empty}>暂无行情源。请先在日常页面触发一次行情调用后回来查看。</Text>
        )}

        {cards.map((c) => {
          const s = c.stat;
          const hasStat = !!s && s.attempts > 0;
          return (
            <View key={c.id} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.cardTitleBox}>
                  <Text style={styles.cardTitle}>{c.label}</Text>
                  <Text style={styles.cardSub}>{c.id}</Text>
                </View>
                {hasStat ? (
                  <View style={styles.usedBadge}>
                    <Text style={styles.usedText}>{apiStats.score(s!)} 分</Text>
                  </View>
                ) : (
                  <View style={styles.idleBadge}>
                    <Text style={styles.idleText}>未调用</Text>
                  </View>
                )}
              </View>

              {hasStat ? (
                <>
                  <View style={styles.metricRow}>
                    <Metric label="成功率" value={`${successRate(s!).toFixed(1)}%`} color={rateColor(successRate(s!))} />
                    <Metric label="平均延迟" value={s!.successes ? `${avgLatency(s!).toFixed(0)}ms` : '—'} />
                    <Metric label="最近成功" value={s!.lastSuccessLatency >= 0 ? `${s!.lastSuccessLatency}ms` : '—'} />
                    <Metric label="成功/失败" value={`${s!.successes}/${s!.failures}`} />
                  </View>

                  <CoverageLine s={s!} />

                  {Object.entries(s!.failureReasons).length > 0 && (
                    <View style={styles.reasons}>
                      <Text style={styles.reasonsTitle}>失败原因（会话内累计）</Text>
                      {Object.entries(s!.failureReasons)
                        .sort((a, b) => b[1] - a[1])
                        .map(([r, c2]) => (
                          <View key={r} style={styles.reasonRow}>
                            <View style={styles.reasonDot} />
                            <Text style={styles.reasonText} numberOfLines={1}>
                              {r}
                            </Text>
                            <Text style={styles.reasonCount}>×{c2}</Text>
                          </View>
                        ))}
                    </View>
                  )}
                </>
              ) : (
                <Text style={styles.idleTextBlock}>
                  本次会话尚未调用。可点下方「单源测试」对该源发起一次真实冒烟（会真实发请求）。
                </Text>
              )}

              {onOpenTest && (
                <TouchableOpacity
                  style={styles.testBtn}
                  onPress={() => onOpenTest(c.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.testBtnText}>单源测试（封装层冒烟） ›</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

/** 栏目覆盖小结：通过 / 失败 / 待测 / 未实现（相对统一栏目表，不含本页请求） */
function CoverageLine({ s }: { s: SourceStat }): React.JSX.Element {
  const ok = new Set<string>();
  // 键虽为强类型 DataSourceMethod，Object.keys 返回 string；此处回退一次窄化
  const okKeys = Object.keys(s.methodsOk) as DataSourceMethod[];
  for (const m of okKeys) if (s.methodsOk[m]) ok.add(m);
  const failKeys = Object.keys(s.methodFails) as DataSourceMethod[];
  const failed = new Set(failKeys.filter((m) => (s.methodFails[m] ?? 0) > 0));
  let okCount = 0;
  let failCount = 0;
  let done = 0;
  // 覆盖口径 = 全部接口方法（数量随 methods.ts 演进）
  for (const m of ALL_METHODS) {
    if (ok.has(m)) okCount += 1;
    else if (failed.has(m)) failCount += 1;
    done += 1;
  }
  const untried = done - okCount - failCount;
  return (
    <View style={styles.coverageRow}>
      <Text style={styles.coverageText}>
        栏目覆盖
        <Text style={styles.okText}> 通过 {okCount}</Text>
        <Text style={styles.failText}> 失败 {failCount}</Text>
        <Text style={styles.untriedText}> 待测 {untried}</Text>
      </Text>
    </View>
  );
}

function rateColor(rate: number): string {
  if (rate >= 99) return colors.down;
  if (rate >= 80) return '#E0A800';
  return colors.up;
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryCell}>
      <Text style={styles.summaryValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, color ? { color } : null]} numberOfLines={1}>
        {value}
      </Text>
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
  headerMid: { alignItems: 'center' },
  back: { color: colors.primary, fontSize: fontSize.md, width: 60 },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  headerHint: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  clear: { color: colors.textSecondary, fontSize: fontSize.md, width: 60, textAlign: 'right' },
  note: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  noteText: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 16 },
  summary: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryCell: { flex: 1, alignItems: 'center' },
  summaryValue: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  summaryLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  list: { flex: 1 },
  listContent: { padding: spacing.md },
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
  cardTitleBox: { flex: 1 },
  cardTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  cardSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  usedBadge: {
    backgroundColor: '#1E7A46',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  usedText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '700' },
  idleBadge: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  idleText: { color: colors.textSecondary, fontSize: fontSize.xs },
  metricRow: { flexDirection: 'row', marginTop: spacing.sm },
  metric: { flex: 1, alignItems: 'center' },
  metricValue: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  metricLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  coverageRow: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  coverageText: { color: colors.textSecondary, fontSize: fontSize.xs },
  okText: { color: colors.down, fontWeight: '700' },
  failText: { color: colors.up, fontWeight: '700' },
  untriedText: { color: colors.textSecondary, fontWeight: '700' },
  reasons: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  reasonsTitle: { color: colors.textSecondary, fontSize: fontSize.xs, marginBottom: spacing.xs },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 2 },
  reasonDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.up },
  reasonText: { flex: 1, color: colors.text, fontSize: fontSize.xs },
  reasonCount: { color: colors.textSecondary, fontSize: fontSize.xs },
  idleTextBlock: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: spacing.sm, lineHeight: 16 },
  testBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  testBtnText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '600' },
});
