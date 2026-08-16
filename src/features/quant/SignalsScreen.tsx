/**
 * 量化专区页：个人专属买卖信号总览 + 策略开关。
 * 富途风格卡片化：买入/卖出分区，红绿箭头，理由与强度；底部可勾选启用的策略。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSignals } from '@/hooks/useSignals';
import { STRATEGIES, type StrategyConfig } from '@/quant/strategies';
import { loadStrategyConfig, saveStrategyConfig } from '@/quant/SignalStore';
import { colors, spacing, fontSize, radius } from '@/theme';

export function SignalsScreen({ onBack, onOpenStock }: { onBack: () => void; onOpenStock?: (key: string) => void }): React.JSX.Element {
  const { buys, sells, reload } = useSignals();
  const [cfg, setCfg] = useState<StrategyConfig>({ enabled: {} });
  const insets = useSafeAreaInsets();

  useEffect(() => {
    loadStrategyConfig().then(setCfg);
    reload();
  }, [reload]);

  const toggle = async (id: string) => {
    const next: StrategyConfig = {
      enabled: { ...cfg.enabled, [id]: !(cfg.enabled[id] ?? STRATEGIES.find((s) => s.id === id)?.enabledByDefault ?? true) },
    };
    setCfg(next);
    await saveStrategyConfig(next);
    reload();
  };

  const renderList = (list: typeof buys, kind: 'buy' | 'sell') => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        {kind === 'buy' ? '买入信号' : '卖出信号'}（{list.length}）
      </Text>
      {list.length === 0 && <Text style={styles.empty}>暂无{kind === 'buy' ? '买入' : '卖出'}信号</Text>}
      {list.map((s) => (
        <TouchableOpacity
          key={s.symbolKey}
          style={styles.card}
          onPress={() => onOpenStock?.(s.symbolKey)}
        >
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
      ))}
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
      <Text style={styles.hint}>在交易时段，行情推送会自动重算上述策略并刷新信号。</Text>
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
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: fontSize.sm },
  cardBody: { flex: 1 },
  code: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  reason: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  strength: { fontSize: fontSize.lg, fontWeight: '700' },
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
