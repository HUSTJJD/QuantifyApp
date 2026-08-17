/**
 * 量化专区页：个人专属买卖信号总览 + 策略开关 + 一键跟单。
 * 富途风格卡片化：买入/卖出分区，红绿箭头，理由与强度；每卡片可一键跟单到模拟盘。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSignals } from '@/hooks/useSignals';
import { useQuotes } from '@/hooks/useMarketData';
import { SimAccountRepo, type SimAccount } from '@/simulation';
import { followSignal, estimateFollowQty, loadFollowed, markFollowed, type FollowResult } from '@/simulation';
import type { TradeSignal } from '@/quant/signals';
import { STRATEGIES, type StrategyConfig } from '@/quant/strategies';
import { loadStrategyConfig, saveStrategyConfig } from '@/quant/SignalStore';
import { colors, spacing, fontSize, radius } from '@/theme';
import { toFullCode } from '@/domain';

const RATIOS: { label: string; value: number }[] = [
  { label: '1/4 仓', value: 0.25 },
  { label: '1/3 仓', value: 1 / 3 },
  { label: '1/2 仓', value: 0.5 },
  { label: '全仓', value: 1 },
];

export function SignalsScreen({ onBack, onOpenStock }: { onBack: () => void; onOpenStock?: (key: string) => void }): React.JSX.Element {
  const { buys, sells, reload } = useSignals();
  const [cfg, setCfg] = useState<StrategyConfig>({ enabled: {} });
  const [ratio, setRatio] = useState<number>(1 / 3);
  const [following, setFollowing] = useState<string | null>(null);
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [account, setAccount] = useState<SimAccount | null>(null);
  const insets = useSafeAreaInsets();

  const allSymbols = [...buys, ...sells].map((s) => s.symbol);
  const { data: quotes } = useQuotes(allSymbols, 'stock');
  const priceMap = new Map<string, number>();
  (quotes ?? []).forEach((q) => priceMap.set(toFullCode(q.symbol), q.last));

  useEffect(() => {
    loadStrategyConfig().then(setCfg);
    reload();
    SimAccountRepo.get().then(setAccount);
    loadFollowed().then(setFollowed);
  }, [reload]);

  const toggle = async (id: string) => {
    const next: StrategyConfig = {
      enabled: { ...cfg.enabled, [id]: !(cfg.enabled[id] ?? STRATEGIES.find((s) => s.id === id)?.enabledByDefault ?? true) },
    };
    setCfg(next);
    await saveStrategyConfig(next);
    reload();
  };

  const priceOf = (s: TradeSignal): number => priceMap.get(s.symbolKey) ?? 0;

  const onFollow = async (s: TradeSignal) => {
    if (s.side === 'hold') return;
    const price = priceOf(s);
    if (price <= 0) {
      Alert.alert('无法跟单', '当前无行情价格，请于交易时段再试');
      return;
    }
    const key = `${s.symbolKey}_${s.side}`;
    setFollowing(key);
    let res: FollowResult;
    try {
      res = await followSignal({ symbol: s.symbol, side: s.side, price, ratio });
    } finally {
      setFollowing(null);
    }
    if (res.ok) {
      await markFollowed(key);
      setFollowed((prev) => new Set(prev).add(key));
      const acc = await SimAccountRepo.get();
      setAccount(acc);
      Alert.alert('跟单成功', `已${s.side === 'buy' ? '买入' : '卖出'} ${s.symbolKey} ${res.qty} 股（市价约 ${price.toFixed(2)}）`, [
        { text: '好的' },
      ]);
    } else {
      Alert.alert('跟单失败', res.message ?? '下单失败');
    }
  };

  const renderList = (list: TradeSignal[], kind: 'buy' | 'sell') => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        {kind === 'buy' ? '买入信号' : '卖出信号'}（{list.length}）
      </Text>
      {list.length === 0 && <Text style={styles.empty}>暂无{kind === 'buy' ? '买入' : '卖出'}信号</Text>}
      {list.map((s) => {
        const price = priceOf(s);
        const key = `${s.symbolKey}_${s.side}`;
        const done = followed.has(key);
        const isFollowing = following === key;
        const previewQty = account && price > 0 && s.side !== 'hold' ? estimateFollowQty(account, s.symbol, s.side, price, ratio) : 0;
        return (
          <View key={key} style={styles.card}>
            <TouchableOpacity style={styles.cardMain} onPress={() => onOpenStock?.(s.symbolKey)}>
              <View style={[styles.badge, { backgroundColor: kind === 'buy' ? colors.up : colors.down }]}>
                <Text style={styles.badgeText}>{kind === 'buy' ? 'B' : 'S'}</Text>
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.code}>{s.symbolKey}</Text>
                <Text style={styles.reason}>{s.reasons.join(' · ')}</Text>
              </View>
              <Text style={[styles.strength, { color: kind === 'buy' ? colors.up : colors.down }]}>
                {s.strength > 0 ? '+' : ''}
                {s.strength}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.followBtn, { backgroundColor: kind === 'buy' ? colors.up : colors.down }, done && styles.followBtnDone]}
              disabled={done || isFollowing}
              onPress={() => onFollow(s)}
            >
              <Text style={styles.followBtnText}>
                {done ? '已跟' : isFollowing ? '…' : `跟单${previewQty > 0 ? ` ${previewQty}` : ''}`}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom }]}
    >
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.title}>量化信号</Text>
        <TouchableOpacity onPress={reload}>
          <Text style={styles.refresh}>刷新</Text>
        </TouchableOpacity>
      </View>

      {/* 跟单仓位比例 */}
      <View style={styles.ratioRow}>
        <Text style={styles.ratioLabel}>跟单仓位</Text>
        {RATIOS.map((r) => (
          <TouchableOpacity
            key={r.label}
            style={[styles.ratioBtn, ratio === r.value && styles.ratioBtnOn]}
            onPress={() => setRatio(r.value)}
          >
            <Text style={[styles.ratioBtnText, ratio === r.value && styles.ratioBtnTextOn]}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {renderList(buys, 'buy')}
      {renderList(sells, 'sell')}

      <Text style={styles.sectionTitle}>我的策略（个人专属）</Text>
      {STRATEGIES.map((s) => {
        const on = cfg.enabled[s.id] ?? s.enabledByDefault;
        return (
          <TouchableOpacity key={s.id} style={styles.strategyRow} onPress={() => toggle(s.id)}>
            <Text style={styles.strategyLabel}>{s.label}</Text>
            <View style={[styles.toggle, on && styles.toggleOn]}>
              <View style={[styles.knob, on && styles.knobOn]} />
            </View>
          </TouchableOpacity>
        );
      })}
      <Text style={styles.hint}>在交易时段，行情推送会自动重算上述策略并刷新信号。跟单按所选仓位比例以市价下单至模拟盘。</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  back: { color: colors.primary, fontSize: fontSize.md },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  refresh: { color: colors.primary, fontSize: fontSize.sm },
  ratioRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg, flexWrap: 'wrap' },
  ratioLabel: { color: colors.textSecondary, fontSize: fontSize.sm, marginRight: spacing.sm },
  ratioBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, marginRight: spacing.xs },
  ratioBtnOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  ratioBtnText: { color: colors.textSecondary, fontSize: fontSize.sm },
  ratioBtnTextOn: { color: '#fff' },
  section: { marginBottom: spacing.lg },
  sectionTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', marginBottom: spacing.sm },
  empty: { color: colors.textSecondary, fontSize: fontSize.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  cardMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: fontSize.sm },
  cardBody: { flex: 1 },
  code: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  reason: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  strength: { fontSize: fontSize.lg, fontWeight: '700', marginHorizontal: spacing.sm },
  followBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, minWidth: 64, alignItems: 'center' },
  followBtnDone: { backgroundColor: colors.surfaceAlt },
  followBtnText: { color: '#fff', fontSize: fontSize.sm, fontWeight: '700' },
  strategyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  strategyLabel: { color: colors.text, fontSize: fontSize.md },
  toggle: { width: 44, height: 26, borderRadius: 13, backgroundColor: colors.border, justifyContent: 'center', paddingHorizontal: 2 },
  toggleOn: { backgroundColor: colors.primary },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  knobOn: { alignSelf: 'flex-end' },
  hint: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: spacing.sm },
});
