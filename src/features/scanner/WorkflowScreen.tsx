/**
 * 工作流页：扫描 → 候选池 → 信号 → 批量跟单。
 *
 * 数据流：
 *  1. 读最新 scan_snapshot → buildCandidatePool
 *  2. 读信号引擎 TradeSignal[] → filterActionableSignals
 *  3. 读模拟盘账户 → planBatchFollow
 *  4. 用户确认后逐笔调 followSignal 执行
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { quantStore } from '@/data/db/QuantStore';
import { getAll as getAllSignals } from '@/quant/SignalStore';
import {
  buildCandidatePool,
  filterActionableSignals,
  planBatchFollow,
  type CandidateItem,
  type ActionableSignal,
  type BatchFollowPlan,
} from '@/quant/candidatePool';
import { SimAccountRepo, followSignal } from '@/simulation';
import type { Symbol } from '@/data/api';
import { spacing, fontSize, radius } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';
import { Card } from '@/components';

interface FollowOutcome {
  code: string;
  exchange: string;
  ok: boolean;
  message: string;
}

export function WorkflowScreen({
  onBack,
  onOpenDetail,
}: {
  onBack?: () => void;
  onOpenDetail?: (symbol: Symbol) => void;
}): React.JSX.Element {
  const { colors: c } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [pool, setPool] = useState<CandidateItem[]>([]);
  const [signals, setSignals] = useState<ActionableSignal[]>([]);
  const [plan, setPlan] = useState<BatchFollowPlan | null>(null);
  const [executing, setExecuting] = useState(false);
  const [outcomes, setOutcomes] = useState<FollowOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [snapshotInfo, setSnapshotInfo] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOutcomes([]);
    try {
      const store = quantStore();
      const snapshots = await store.listScanSnapshots(1);
      if (snapshots.length === 0) {
        setError('暂无扫描快照，请先在「全市场扫描」页执行一次扫描');
        setPool([]);
        setSignals([]);
        setPlan(null);
        return;
      }
      const snap = snapshots[0];
      const hitRows = await store.listScanHits(snap.id!);
      const candidatePool = buildCandidatePool(hitRows);
      setPool(candidatePool);
      const time = new Date(snap.createdAt).toLocaleString('zh-CN');
      let sourceLabel = '';
      try {
        const crit = JSON.parse(snap.criteria) as { source?: string };
        if (crit?.source === 'eod') sourceLabel = '尾盘 · ';
      } catch {
        // ignore
      }
      setSnapshotInfo(`${sourceLabel}${time} · 命中 ${snap.hitCount} · 扫描 ${snap.total}`);

      const allSignals = await getAllSignals();
      const actionable = filterActionableSignals(allSignals, candidatePool);
      setSignals(actionable);

      const acc = await SimAccountRepo.get();
      const followPlan = planBatchFollow(actionable, acc, 0.3, 3);
      setPlan(followPlan);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const executePlan = useCallback(async () => {
    if (!plan || plan.actionable === 0) return;
    setExecuting(true);
    setOutcomes([]);
    const results: FollowOutcome[] = [];
    for (const item of plan.items) {
      if (item.qty <= 0) {
        results.push({ code: item.symbol.code, exchange: item.symbol.exchange, ok: false, message: item.skipReason ?? '跳过' });
        continue;
      }
      try {
        const r = await followSignal({
          symbol: item.symbol,
          side: item.side,
          price: item.price,
          ratio: 0.3,
          openThsAfterFollow: false, // 批量跟单不逐个跳同花顺
        });
        results.push({
          code: item.symbol.code,
          exchange: item.symbol.exchange,
          ok: r.ok,
          message: r.ok ? `${item.side === 'buy' ? '买入' : '卖出'} ${r.qty} 股` : (r.message ?? '失败'),
        });
      } catch (e) {
        results.push({ code: item.symbol.code, exchange: item.symbol.exchange, ok: false, message: String(e) });
      }
      setOutcomes([...results]);
    }
    setExecuting(false);
  }, [plan]);

  const styles = makeStyles(c);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name={Icons.chevronRight} size={24} color={c.text} style={{ transform: [{ rotate: '180deg' }] }} />
        </TouchableOpacity>
        <Text style={styles.title}>工作流</Text>
        <TouchableOpacity onPress={load} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name={Icons.refresh} size={20} color={c.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        {loading && <ActivityIndicator style={{ marginTop: spacing.xl }} color={c.primary} />}
        {error && <Text style={styles.error}>{error}</Text>}

        {!loading && !error && (
          <>
            {/* 步骤 1：候选池 */}
            <StepCard
              step={1}
              title="候选池"
              subtitle={snapshotInfo}
              count={pool.length}
              colors={c}
            />
            {pool.length > 0 && (
              <Card style={styles.listCard}>
                {pool.slice(0, 10).map((item) => (
                  <TouchableOpacity
                    key={`${item.symbol.code}.${item.symbol.exchange}`}
                    style={styles.row}
                    onPress={() => onOpenDetail?.(item.symbol)}
                  >
                    <View style={styles.rowLeft}>
                      <Text style={styles.rowName}>{item.name}</Text>
                      <Text style={styles.rowSub}>{item.symbol.exchange}.{item.symbol.code} · {item.reasons}</Text>
                    </View>
                    <View style={styles.rowRight}>
                      <Text style={styles.rowPrice}>{item.lastClose.toFixed(2)}</Text>
                      {item.changePct != null && (
                        <Text style={[styles.rowPct, { color: item.changePct >= 0 ? c.up : c.down }]}>
                          {item.changePct >= 0 ? '+' : ''}{item.changePct.toFixed(2)}%
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
                {pool.length > 10 && <Text style={styles.more}>还有 {pool.length - 10} 只…</Text>}
              </Card>
            )}

            {/* 步骤 2：可操作信号 */}
            <StepCard
              step={2}
              title="可操作信号"
              subtitle={signals.length > 0 ? `按强度降序 · 最多跟单 3 笔买入` : '候选池内暂无 buy/sell 信号'}
              count={signals.length}
              colors={c}
            />
            {signals.length > 0 && (
              <Card style={styles.listCard}>
                {signals.map((sig) => (
                  <View key={`${sig.symbol.code}.${sig.symbol.exchange}`} style={styles.row}>
                    <View style={styles.rowLeft}>
                      <Text style={styles.rowName}>{sig.symbol.name || sig.symbol.code}</Text>
                      <Text style={styles.rowSub}>{sig.reasons.slice(0, 2).join(' · ')}</Text>
                    </View>
                    <View style={styles.rowRight}>
                      <Text style={[styles.sideBadge, { backgroundColor: sig.side === 'buy' ? c.up : c.down }]}>
                        {sig.side === 'buy' ? '买入' : '卖出'}
                      </Text>
                      <Text style={styles.strength}>强度 {sig.strength.toFixed(1)}</Text>
                    </View>
                  </View>
                ))}
              </Card>
            )}

            {/* 步骤 3：跟单计划 */}
            <StepCard
              step={3}
              title="跟单计划"
              subtitle={plan ? `可执行 ${plan.actionable} 笔 · 跳过 ${plan.skipped} 笔` : ''}
              count={plan?.actionable ?? 0}
              colors={c}
            />
            {plan && plan.items.length > 0 && (
              <Card style={styles.listCard}>
                {plan.items.map((item) => (
                  <View key={`${item.symbol.code}.${item.symbol.exchange}`} style={styles.row}>
                    <View style={styles.rowLeft}>
                      <Text style={styles.rowName}>{item.symbol.name || item.symbol.code}</Text>
                      <Text style={styles.rowSub}>
                        {item.qty > 0
                          ? `${item.side === 'buy' ? '买入' : '卖出'} ${item.qty} 股 @ ${item.price.toFixed(2)}`
                          : item.skipReason}
                      </Text>
                    </View>
                    <Text style={[styles.qtyBadge, { color: item.qty > 0 ? c.primary : c.textSecondary }]}>
                      {item.qty > 0 ? `${item.qty}` : '跳过'}
                    </Text>
                  </View>
                ))}
              </Card>
            )}

            {/* 执行按钮 */}
            {plan && plan.actionable > 0 && outcomes.length === 0 && (
              <TouchableOpacity
                style={[styles.execBtn, executing && styles.execBtnDisabled]}
                onPress={executePlan}
                disabled={executing}
              >
                <Text style={styles.execBtnText}>
                  {executing ? '执行中…' : `一键跟单（${plan.actionable} 笔）`}
                </Text>
              </TouchableOpacity>
            )}

            {/* 执行结果 */}
            {outcomes.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>执行结果</Text>
                <Card style={styles.listCard}>
                  {outcomes.map((o, i) => (
                    <View key={i} style={styles.row}>
                      <Text style={styles.rowName}>{o.code}.{o.exchange}</Text>
                      <Text style={[styles.outcomeMsg, { color: o.ok ? c.up : c.down }]}>{o.message}</Text>
                    </View>
                  ))}
                </Card>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StepCard({ step, title, subtitle, count, colors }: {
  step: number;
  title: string;
  subtitle: string;
  count: number;
  colors: ReturnType<typeof useAppTheme>['colors'];
}): React.JSX.Element {
  const styles = makeStyles(colors);
  return (
    <View style={styles.stepHeader}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{step}</Text>
      </View>
      <View style={styles.stepInfo}>
        <Text style={styles.stepTitle}>{title}</Text>
        {subtitle ? <Text style={styles.stepSub}>{subtitle}</Text> : null}
      </View>
      <Text style={[styles.stepCount, { color: count > 0 ? colors.primary : colors.textSecondary }]}>
        {count}
      </Text>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    container: { flex: 1, padding: spacing.md },
    scrollContent: { paddingBottom: spacing.xxl },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    backBtn: { paddingRight: spacing.sm },
    title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700', flex: 1 },
    error: { color: colors.down, fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.xl },
    sectionTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.sm },

    stepHeader: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.sm },
    stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
    stepNumText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '700' },
    stepInfo: { flex: 1 },
    stepTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
    stepSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    stepCount: { fontSize: fontSize.lg, fontWeight: '700' },

    listCard: { padding: 0 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowLeft: { flex: 1, marginRight: spacing.sm },
    rowName: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
    rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    rowRight: { alignItems: 'flex-end' },
    rowPrice: { color: colors.text, fontSize: fontSize.sm },
    rowPct: { fontSize: fontSize.xs, marginTop: 2 },
    more: { color: colors.textSecondary, fontSize: fontSize.xs, textAlign: 'center', paddingVertical: spacing.xs },

    sideBadge: { color: '#fff', fontSize: fontSize.xs, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm, overflow: 'hidden' },
    strength: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    qtyBadge: { fontSize: fontSize.sm, fontWeight: '600' },

    execBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.lg },
    execBtnDisabled: { opacity: 0.5 },
    execBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },

    outcomeMsg: { fontSize: fontSize.xs },
  });
}
