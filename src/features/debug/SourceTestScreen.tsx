/**
 * SourceTestScreen —— 单行情源自检页 + 源覆盖矩阵。
 *
 * 入口：行情源统计页 → 每个源的「单源测试」。
 *
 * 说明：
 *  - 测试基于封装方法（与 SourceRouter 相同的参数契约），对该源直接发起真实调用，
 *    不经过路由兜底/熔断；结果只留在本页，不写入 apiStats 埋点；
 *  - 所有源都按同一套「栏目表」渲染：源没有实现的接口同样显示对应栏目，
 *    并标注「未实现/不支持」，横向可比；
 *  - 「全部测试」仅会真实请求该源声明且提供夹具的栏目；
 *  - 顶部「覆盖矩阵」按能力分组汇总本源支持/可测/待测，便于一眼看出缺口。
 */
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getSource, marketData } from '@/api';
import type { MarketDataSource } from '@/api';
import type { SourceProbeResult } from '@/api/MarketDataClient';
import { apiStats } from '@/api/ApiStabilityStats';
import { auditSource } from '@/api/contract/audit';
import {
  METHOD_CATALOG,
  catalogByGroup,
  METHOD_GROUP_TITLES,
  type MethodCatalogEntry,
} from '@/api/contract/catalog';
import { expectationOf } from '@/api/contract/expectations';
import { colors, spacing, fontSize, radius } from '@/theme';

type RowResult = SourceProbeResult & { state: 'idle' | 'running' | 'done' };

/** 全部接口方法的目录项（扁平数组，供筛选/批量执行；数量随 methods.ts 演进） */
const ALL_CATALOG = Object.values(METHOD_CATALOG) as MethodCatalogEntry[];

function emptyRow(): RowResult {
  return { ok: false, unsupported: false, latencyMs: 0, count: -1, state: 'idle' };
}

/** 单分组覆盖统计 */
type GroupCoverage = {
  key: string;
  title: string;
  total: number;
  supported: number;
  runnable: number;
  /** 本组在 results 中已完成的测试数 */
  tested: number;
};

export function SourceTestScreen({
  sourceId,
  onBack,
}: {
  sourceId: string;
  onBack: () => void;
}): React.JSX.Element {
  const [source, setSource] = useState<MarketDataSource | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [runSeq, setRunSeq] = useState<string | null>(null); // 'single:method' | 'all'
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    try {
      setSource(getSource(sourceId));
      setLoadErr('');
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
      setSource(null);
    }
  }, [sourceId]);

  const stat = apiStats.getStat(sourceId);

  /**
   * 可跑口径 = 契约期望「该源支持」且有冒烟夹具。
   * 用 expectations 而非 capabilities：期望是"应该能用"，声明是"自称能用"，
   * 两者不一致时以期望为准，UI 上就会显示成待修的缺口而不是悄悄跳过。
   */
  const runnableSet = useMemo(() => {
    if (!source) return new Set<string>();
    const set = new Set<string>();
    for (const d of ALL_CATALOG) {
      if (!d.buildArgs) continue;
      if (expectationOf(source.id, d.method) !== 'supported') continue;
      if (typeof (source as unknown as Record<string, unknown>)[d.method] !== 'function') continue;
      set.add(d.method);
    }
    return set;
  }, [source]);

  const groups = useMemo(() => catalogByGroup(), []);

  /** 按能力分组的覆盖矩阵（支持 / 可测 / 已测 / 总数） */
  const coverage = useMemo<GroupCoverage[]>(() => {
    if (!source) return [];
    return groups.map((g) => {
      let supported = 0;
      let canRun = 0;
      let tested = 0;
      for (const d of g.items) {
        if (expectationOf(source.id, d.method) === 'supported') supported += 1;
        if (runnableSet.has(d.method)) {
          canRun += 1;
          if (results[d.method]?.state === 'done') tested += 1;
        }
      }
      return {
        key: g.key,
        title: METHOD_GROUP_TITLES[g.key] ?? g.key,
        total: g.items.length,
        supported,
        runnable: canRun,
        tested,
      };
    });
  }, [source, groups, runnableSet, results]);

  /** 能力审计：声明 / 实现 / 闲置，暴露「封装埋没的能力」 */
  const audit = useMemo(() => (source ? auditSource(source) : null), [source]);

  const setRow = useCallback((method: string, patch: Partial<RowResult>) => {
    setResults((prev) => ({ ...prev, [method]: { ...(prev[method] ?? emptyRow()), ...patch } }));
  }, []);

  const runOne = useCallback(
    async (d: MethodCatalogEntry) => {
      if (!runnableSet.has(d.method) || !d.buildArgs) return;
      setRow(d.method, { state: 'running' });
      try {
        const r = await marketData.probeSource(sourceId, d.method, d.buildArgs());
        setRow(d.method, { ...r, state: 'done' });
      } catch (e) {
        setRow(d.method, {
          ok: false,
          unsupported: false,
          latencyMs: 0,
          count: -1,
          error: e instanceof Error ? e.message : String(e),
          state: 'done',
        });
      }
    },
    [runnableSet, sourceId, setRow],
  );

  const runAll = useCallback(async () => {
    const targets = ALL_CATALOG.filter((d) => runnableSet.has(d.method) && d.buildArgs);
    if (targets.length === 0) return;
    setRunSeq('all');
    setProgress({ done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      await runOne(targets[i]);
      setProgress({ done: i + 1, total: targets.length });
    }
    setRunSeq(null);
    setProgress(null);
  }, [runnableSet, runOne]);

  const busy = runSeq !== null;

  const summary =
    source && !loadErr ? (
      <View style={styles.summary}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>状态</Text>
          <Text style={styles.summaryValue}>{source.label}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>会话统计</Text>
          <Text style={styles.summaryValue}>
            {stat && stat.attempts > 0
              ? `请求 ${stat.attempts} · 成功 ${stat.successes} · 失败 ${stat.failures}`
              : '本次会话尚未被日常请求调用'}
          </Text>
        </View>
        {audit && (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>能力审计</Text>
            <Text style={styles.summaryValue}>
              声明 {audit.declaredCount} · 实现 {audit.implementedCount} · 期望 {audit.expectedCount}
              {audit.sourceOnlyMethods.length > 0 ? ` · 闲置 ${audit.sourceOnlyMethods.length}` : ''}
              {audit.gaps.length > 0 ? ` · 缺口 ${audit.gaps.length}` : ''}
            </Text>
          </View>
        )}
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>接口目录</Text>
          <Text style={styles.summaryValue}>
            {ALL_CATALOG.length} 方法 · 可测 {runnableSet.size}
          </Text>
        </View>
        {coverage.length > 0 && (
          <View style={styles.matrix}>
            <Text style={styles.matrixTitle}>源覆盖矩阵（支持/可测 · 总数）</Text>
            <View style={styles.matrixGrid}>
              {coverage.map((row) => (
                <View key={row.key} style={styles.matrixCell}>
                  <Text style={styles.matrixLabel} numberOfLines={1}>
                    {row.title}
                  </Text>
                  <Text
                    style={[
                      styles.matrixValue,
                      row.supported === 0 && styles.matrixZero,
                      row.supported > 0 && row.supported < row.total && styles.matrixPartial,
                      row.supported === row.total && row.total > 0 && styles.matrixFull,
                    ]}
                  >
                    {row.supported}/{row.runnable} · {row.total}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
        {audit && audit.sourceOnlyMethods.length > 0 && (
          <Text style={styles.tip}>
            接口外闲置能力（SourceRouter 路由不到，需补录）：
            {audit.sourceOnlyMethods.slice(0, 10).join('、')}
            {audit.sourceOnlyMethods.length > 10 ? ` 等 ${audit.sourceOnlyMethods.length} 个` : ''}
          </Text>
        )}
        <Text style={styles.tip}>
          测试基于封装方法直接对该源发起真实请求（不兜底），结果仅保存在本页，不计入上方会话统计。
        </Text>
      </View>
    ) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.back}>‹ 返回</Text>
        </TouchableOpacity>
        <View style={styles.headerMid}>
          <Text style={styles.title}>{source?.label ?? sourceId}</Text>
          <Text style={styles.headerHint}>{sourceId} · 单源测试</Text>
        </View>
        <TouchableOpacity
          onPress={runAll}
          disabled={busy || runnableSet.size === 0}
          style={styles.runAllBtn}
        >
          <Text style={[styles.runAllText, (busy || runnableSet.size === 0) && styles.disabledText]}>
            {busy && runSeq === 'all'
              ? progress
                ? `测试中 ${progress.done}/${progress.total}`
                : '测试中…'
              : '全部测试'}
          </Text>
        </TouchableOpacity>
      </View>

      {loadErr ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>该行情源不可用或未注册：{loadErr}</Text>
        </View>
      ) : (
        summary
      )}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {groups.map((g) => (
          <View key={g.key} style={styles.group}>
            <Text style={styles.groupTitle}>{g.title}</Text>
            {g.items.map((d) => {
              const r = results[d.method] ?? emptyRow();
              const can = runnableSet.has(d.method);
              const disabled = busy || !can;
              return (
                <View key={d.method} style={styles.row}>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowLabel}>{d.label}</Text>
                    <Text style={styles.rowMethod}>{d.method}</Text>
                    <ResultLine r={r} d={d} can={can} />
                  </View>
                  <TouchableOpacity
                    style={[styles.runBtn, (disabled || r.state === 'running') && styles.runBtnDisabled]}
                    disabled={disabled || r.state === 'running'}
                    onPress={() => {
                      setRunSeq(`single:${d.method}`);
                      runOne(d).finally(() => setRunSeq(null));
                    }}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Text style={[styles.runBtnText, (disabled || r.state === 'running') && styles.runBtnTextDisabled]}>
                      {r.state === 'running' ? '…' : can ? '测' : '—'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function ResultLine({ r, d, can }: { r: RowResult; d: MethodCatalogEntry; can: boolean }): React.JSX.Element {
  if (!can) {
    const reason = !d.buildArgs ? '暂无自动测试夹具' : '该源未声明此能力（契约期望：不支持）';
    return <Text style={[styles.result, styles.resultUnsupported]}>不支持 · {reason}</Text>;
  }
  if (r.state === 'running') {
    return <Text style={[styles.result, styles.resultRunning]}>测试中…</Text>;
  }
  if (r.state === 'idle') {
    return <Text style={[styles.result, styles.resultIdle]}>未测试</Text>;
  }
  if (r.ok) {
    return (
      <Text style={[styles.result, styles.resultOk]} numberOfLines={1}>
        ✓ {r.count >= 0 ? `${r.count} 条` : '成功'} · {r.latencyMs}ms{r.sample ? ` · ${r.sample}` : ''}
      </Text>
    );
  }
  if (r.unsupported) {
    return (
      <Text style={[styles.result, styles.resultUnsupported]} numberOfLines={1}>
        不支持 · {r.error ?? ''}
      </Text>
    );
  }
  return (
    <Text style={[styles.result, styles.resultFail]} numberOfLines={1}>
      ✗ {r.error ?? '失败'} · {r.latencyMs}ms
    </Text>
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
  headerMid: { alignItems: 'center', flex: 1, paddingHorizontal: spacing.sm },
  back: { color: colors.primary, fontSize: fontSize.md, width: 60 },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  headerHint: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  runAllBtn: { minWidth: 72, alignItems: 'flex-end' },
  runAllText: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '700' },
  disabledText: { color: colors.textSecondary },
  notice: {
    margin: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noticeText: { color: colors.textSecondary, fontSize: fontSize.sm },
  summary: {
    margin: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  summaryLabel: { color: colors.textSecondary, fontSize: fontSize.xs },
  summaryValue: { color: colors.text, fontSize: fontSize.xs, fontWeight: '600', maxWidth: '60%' },
  tip: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: spacing.xs, lineHeight: 15 },
  matrix: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  matrixTitle: { color: colors.textSecondary, fontSize: fontSize.xs, marginBottom: spacing.xs },
  matrixGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  matrixCell: { width: '33.33%', paddingVertical: 2, paddingRight: spacing.xs },
  matrixLabel: { color: colors.textSecondary, fontSize: 10 },
  matrixValue: { color: colors.text, fontSize: fontSize.xs, fontWeight: '600' },
  matrixZero: { color: colors.textSecondary },
  matrixPartial: { color: '#E0A800' },
  matrixFull: { color: colors.down },
  list: { flex: 1 },
  listContent: { padding: spacing.md, paddingBottom: spacing.xl },
  group: { marginBottom: spacing.md },
  groupTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
  },
  rowMain: { flex: 1, paddingRight: spacing.sm },
  rowLabel: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  rowMethod: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 1 },
  result: { fontSize: fontSize.xs, marginTop: 3 },
  resultRunning: { color: '#E0A800' },
  resultIdle: { color: colors.textSecondary },
  resultOk: { color: colors.down },
  resultFail: { color: colors.up },
  resultUnsupported: { color: colors.textSecondary },
  runBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  runBtnDisabled: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  runBtnText: { color: '#fff', fontSize: fontSize.sm, fontWeight: '700' },
  runBtnTextDisabled: { color: colors.textSecondary },
});
