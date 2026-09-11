/**
 * 策略工作台（底部「策略」Tab 根页）。
 *
 * 每个策略档案一行卡片：基础开关（启用/自动交易）、规则摘要、
 * 快速回测 / 编辑 / 专属模拟盘入口；支持新增策略（内置模板）。
 * 顶部展示策略运行概况与最近的自动交易动态；异动提醒保留（含底部角标）。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { getProfiles, upsertProfile, deleteProfile } from '@/quant/profileStore';
import type { StrategyProfile } from '@/quant/profile';
import { SESSION_LABELS, PERIOD_LABELS, templateById } from '@/quant/profile';
import { STRATEGIES } from '@/quant/strategies';
import { recentStrategyEvents, strategyAccountRepo } from '@/quant/StrategyEngine';
import { useAlertCenter } from '@/features/watchlist/alertCenter';
import { toFullCode } from '@/domain';
import { spacing, fontSize, radius, fontWeight } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { Card, Section, Tag, Toggle, EmptyState, Icon } from '@/components';
import { Icons } from '@/assets/icons';

export function StrategiesScreen({
  onEdit,
  onCreate,
  onBacktest,
  onOpenSim,
  onOpenStock,
}: {
  onEdit: (id: string) => void;
  onCreate: () => void;
  onBacktest: (id: string) => void;
  onOpenSim: (id: string) => void;
  onOpenStock?: (key: string) => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { state: alertState, markRead } = useAlertCenter();
  const [profiles, setProfiles] = useState<StrategyProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [simMeta, setSimMeta] = useState<Record<string, { pos: number; trades: number }>>({});

  const load = useCallback(async () => {
    const ps = await getProfiles();
    setProfiles(ps);
    const meta: Record<string, { pos: number; trades: number }> = {};
    for (const p of ps) {
      if (p.autoTrade) {
        try {
          const acc = await strategyAccountRepo(p.id).get();
          meta[p.id] = { pos: acc.positions.length, trades: acc.trades.length };
        } catch {
          meta[p.id] = { pos: 0, trades: 0 };
        }
      }
    }
    setSimMeta(meta);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setLoading(false));
      if (alertState.unread > 0) markRead();
    }, [load, alertState.unread, markRead]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const patch = useCallback(async (id: string, fn: (p: StrategyProfile) => StrategyProfile) => {
    setBusyId(id);
    try {
      const cur = (await getProfiles()).find((p) => p.id === id);
      if (!cur) return;
      const next = await upsertProfile(fn(cur));
      setProfiles(next);
    } finally {
      setBusyId(null);
    }
  }, []);

  const toggleEnabled = useCallback(
    (p: StrategyProfile) => patch(p.id, (x) => ({ ...x, enabled: !x.enabled })),
    [patch],
  );
  const toggleAuto = useCallback(
    (p: StrategyProfile) => patch(p.id, (x) => ({ ...x, autoTrade: !x.autoTrade })),
    [patch],
  );

  const remove = useCallback(async (id: string) => {
    setProfiles(await deleteProfile(id));
  }, []);

  const usedTemplates = useMemo(() => new Set(profiles.map((p) => p.templateId)), [profiles]);
  const unusedTemplates = useMemo(
    () => STRATEGIES.filter((s) => !usedTemplates.has(s.id)).length,
    [usedTemplates],
  );
  const enabledCount = profiles.filter((p) => p.enabled).length;
  const autoCount = profiles.filter((p) => p.enabled && p.autoTrade).length;
  const events = useMemo(() => recentStrategyEvents().slice(0, 6), []);

  const styles = makeStyles(colors);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
      }
    >
      {/* 运行概况 */}
      <Card style={styles.overview}>
        <View style={styles.overviewRow}>
          <StatCol value={profiles.length} label="策略数" color={colors.text} />
          <View style={styles.overviewDivider} />
          <StatCol value={enabledCount} label="已启用" color={colors.primary} />
          <View style={styles.overviewDivider} />
          <StatCol value={autoCount} label="自动交易" color={colors.up} />
        </View>
      </Card>

      {/* 自动交易动态 */}
      {events.length > 0 && (
        <>
          <Section title="自动交易动态" action={<Tag text={String(recentStrategyEvents().length)} variant="neutral" color={colors.info} />} />
          <Card padded={false} style={styles.eventsCard}>
            {events.map((e, i) => (
              <View key={`${e.ts}-${i}`} style={[styles.eventRow, i > 0 && styles.hairlineTop]}>
                <View style={[styles.eventBadge, { backgroundColor: e.side === 'buy' ? colors.up : colors.down }]}>
                  <Text style={styles.eventBadgeText}>{e.side === 'buy' ? '买' : '卖'}</Text>
                </View>
                <View style={styles.eventBody}>
                  <Text style={styles.eventName} numberOfLines={1}>
                    {e.name} · {e.symbolKey}
                  </Text>
                  <Text style={styles.eventMsg} numberOfLines={1}>
                    {e.reason}
                  </Text>
                </View>
                <Text style={styles.eventPrice}>{e.qty}股@{e.price.toFixed(2)}</Text>
              </View>
            ))}
          </Card>
        </>
      )}

      {/* 策略卡片列表 */}
      <Section
        title="我的策略"
        action={
          <TouchableOpacity onPress={onCreate} disabled={unusedTemplates === 0} activeOpacity={0.7}>
            <Text style={[styles.addText, unusedTemplates === 0 && { color: colors.textSecondary }]}>
              + 新增策略
            </Text>
          </TouchableOpacity>
        }
      />

      {!loading && profiles.length === 0 && (
        <Card style={styles.emptyCard}>
          <EmptyState text="还没有策略" hint="点击右上角「+ 新增策略」，从内置策略模板开始" />
        </Card>
      )}

      {profiles.map((p) => (
        <StrategyCard
          key={p.id}
          profile={p}
          meta={simMeta[p.id]}
          busy={busyId === p.id}
          onToggleEnabled={() => toggleEnabled(p)}
          onToggleAuto={() => toggleAuto(p)}
          onEdit={() => onEdit(p.id)}
          onBacktest={() => onBacktest(p.id)}
          onOpenSim={() => onOpenSim(p.id)}
          onRemove={() => remove(p.id)}
          colors={colors}
        />
      ))}

      {/* 异动提醒（跟随自选股） */}
      {alertState.events.length > 0 && (
        <>
          <Section title="异动提醒" action={<Tag text={String(alertState.events.length)} variant="neutral" color={colors.warning} />} />
          <Card padded={false} style={styles.eventsCard}>
            {alertState.events.slice(0, 4).map((ev, i) => (
              <TouchableOpacity
                key={`${ev.ruleId}-${ev.time}-${i}`}
                style={[styles.eventRow, i > 0 && styles.hairlineTop]}
                onPress={() => onOpenStock?.(toFullCode(ev.symbol))}
                activeOpacity={0.7}
              >
                <View style={[styles.eventBadge, { backgroundColor: ev.value >= 0 ? colors.up : colors.down }]}>
                  <Icon name={ev.type === 'pct' ? Icons.trendUp : ev.type === 'volumeSpike' ? Icons.fire : Icons.bell} size="sm" color="#fff" />
                </View>
                <View style={styles.eventBody}>
                  <Text style={styles.eventName} numberOfLines={1}>{ev.symbol.name ?? ev.symbol.code}</Text>
                  <Text style={styles.eventMsg} numberOfLines={1}>{ev.message}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </Card>
        </>
      )}

      <Text style={styles.hint}>
        在交易时段（A股 9:30-11:30 / 13:00-15:00）内，开启自动交易的策略会按所选时段与信号实时触发，并写入该策略的专属模拟盘。可在「我的」→ 回测 或卡片内快速回测先行验证。
      </Text>
    </ScrollView>
  );
}

/** 单个策略卡片 */
function StrategyCard({
  profile,
  meta,
  busy,
  onToggleEnabled,
  onToggleAuto,
  onEdit,
  onBacktest,
  onOpenSim,
  onRemove,
  colors,
}: {
  profile: StrategyProfile;
  meta?: { pos: number; trades: number };
  busy?: boolean;
  onToggleEnabled: () => void;
  onToggleAuto: () => void;
  onEdit: () => void;
  onBacktest: () => void;
  onOpenSim: () => void;
  onRemove: () => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
}): React.JSX.Element {
  const t = templateById(profile.templateId);
  const ex = profile.exit;
  const exitChips = [
    ex.stopLossPct > 0 ? `止损 ${ex.stopLossPct}%` : null,
    ex.takeProfitPct > 0 ? `止盈 ${ex.takeProfitPct}%` : null,
    ex.trailingPct > 0 ? `移动止损 ${ex.trailingPct}%` : null,
  ].filter(Boolean) as string[];
  const styles = makeStyles(colors);

  return (
    <Card style={styles.strategyCard} padded={false}>
      <View style={styles.cardHead}>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle} numberOfLines={1}>{profile.name}</Text>
          {profile.enabled && (
            <Tag
              text={profile.autoTrade ? '自动交易中' : '运行中'}
              variant="neutral"
              color={profile.autoTrade ? colors.up : colors.info}
            />
          )}
        </View>
        <View style={styles.toggleWrap}>
          <Text style={styles.toggleLabel}>启用</Text>
          <Toggle on={profile.enabled} disabled={busy} onChange={onToggleEnabled} />
        </View>
      </View>

      <View style={styles.cardMetaWrap}>
        <Text style={styles.cardMeta} numberOfLines={2}>
          {t?.label ?? profile.note} · {PERIOD_LABELS[profile.trade.period]} · {SESSION_LABELS[profile.trade.session]} · 仓位
          {Math.round(profile.trade.positionRatio * 100)}% · 最多 {profile.trade.maxPositions} 只
        </Text>
        {exitChips.length > 0 && (
          <Text style={styles.cardExit} numberOfLines={1}>
            风控：{exitChips.join('　')}
          </Text>
        )}
      </View>

      <View style={[styles.autoRow, { borderTopColor: colors.border }]}>
        <View style={styles.autoLeft}>
          <Text style={styles.autoLabel}>专属模拟盘</Text>
          <Text style={styles.autoSub}>
            {profile.autoTrade ? (meta ? `持仓 ${meta.pos} · 成交 ${meta.trades} 笔` : '已开启') : '信号自动触发交易'}
          </Text>
        </View>
        <Toggle on={profile.autoTrade} accent={colors.up} disabled={busy || !profile.enabled} onChange={onToggleAuto} />
      </View>

      <View style={[styles.actionsRow, { borderTopColor: colors.border }]}>
        <ActionBtn label="快速回测" onPress={onBacktest} color={colors.primary} />
        <ActionBtn label="模拟盘" onPress={onOpenSim} color={colors.textSecondary} disabled={!profile.autoTrade} />
        <ActionBtn label="编辑" onPress={onEdit} color={colors.primary} />
        <TouchableOpacity onPress={onRemove} style={styles.removeBtn} activeOpacity={0.7}>
          <Text style={[styles.removeText, { color: colors.textSecondary }]}>删除</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
}

function ActionBtn({
  label,
  onPress,
  color,
  disabled,
}: {
  label: string;
  onPress: () => void;
  color: string;
  disabled?: boolean;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity
      style={[styles.actionBtn, { borderColor: disabled ? colors.border : color }]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      <Text style={[styles.actionText, { color: disabled ? colors.textSecondary : color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** 概览统计列 */
function StatCol({ value, label, color }: { value: number; label: string; color: string }): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.statCol}>
      <Text style={[styles.statNum, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.md },

    overview: { marginBottom: spacing.md },
    overviewRow: { flexDirection: 'row', alignItems: 'center' },
    overviewDivider: { width: 1, height: 30, backgroundColor: colors.border },
    statCol: { flex: 1, alignItems: 'center' },
    statNum: { fontSize: fontSize.xl + 2, fontWeight: fontWeight.heavy as any },
    statLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },

    eventsCard: { overflow: 'hidden' },
    eventRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    eventBadge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
    eventBadgeText: { color: '#fff', fontSize: fontSize.sm, fontWeight: fontWeight.bold as any },
    eventBody: { flex: 1 },
    eventName: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
    eventMsg: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 1 },
    eventPrice: { color: colors.textSecondary, fontSize: fontSize.xs, marginLeft: spacing.sm },

    strategyCard: { marginBottom: spacing.sm, overflow: 'hidden' },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingTop: spacing.md },
    cardTitleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginRight: spacing.sm },
    cardTitle: { color: colors.text, fontSize: fontSize.md + 2, fontWeight: fontWeight.heavy as any, flexShrink: 1 },
    toggleWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    toggleLabel: { color: colors.textSecondary, fontSize: fontSize.xs },
    cardMetaWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
    cardMeta: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 16 },
    cardExit: { color: colors.text, fontSize: fontSize.xs, marginTop: 4, fontWeight: '500' },

    autoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
    autoLeft: { flex: 1, marginRight: spacing.sm },
    autoLabel: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
    autoSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 1 },

    actionsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
    actionBtn: { flex: 1, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
    actionText: { fontSize: fontSize.sm, fontWeight: '600' },
    removeBtn: { paddingHorizontal: spacing.sm },
    removeText: { fontSize: fontSize.xs },

    addText: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '600' },
    emptyCard: { marginTop: spacing.md },
    hint: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 17, marginTop: spacing.lg, paddingHorizontal: spacing.sm },
    hairlineTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  });
}
