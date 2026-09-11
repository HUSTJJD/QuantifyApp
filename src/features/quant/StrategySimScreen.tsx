/**
 * 策略专属模拟盘：查看该策略档案独立账户的资金 / 持仓 / 成交明细，
 * 并支持一键重置回初始资金（与全局模拟盘完全隔离）。
 * 自动交易开启后，信号与风控触发会实时写入此账户。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getProfile } from '@/quant/profileStore';
import type { StrategyProfile } from '@/quant/profile';
import { strategyAccountRepo } from '@/quant/StrategyEngine';
import type { SimAccount } from '@/simulation';
import { toFullCode } from '@/domain';
import { spacing, fontSize, fontWeight } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { Card, Section, Tag } from '@/components';

export function StrategySimScreen({
  onBack,
  strategyId,
}: {
  onBack?: () => void;
  strategyId: string;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<StrategyProfile | null>(null);
  const [acc, setAcc] = useState<SimAccount | null>(null);

  const load = useCallback(async () => {
    const p = await getProfile(strategyId);
    setProfile(p ?? null);
    if (p) {
      setAcc(await strategyAccountRepo(p.id).get());
    }
  }, [strategyId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const reset = useCallback(() => {
    Alert.alert('重置专属模拟盘', `将清空「${profile?.name}」的持仓与成交记录，并恢复初始资金。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '重置',
        style: 'destructive',
        onPress: async () => {
          await strategyAccountRepo(strategyId).reset();
          setAcc(await strategyAccountRepo(strategyId).get());
        },
      },
    ]);
  }, [profile, strategyId]);

  const styles = makeStyles(colors);
  const posCost = (acc?.positions ?? []).reduce((s, p) => s + p.costPrice * p.shares, 0);
  const recentTrades = [...(acc?.trades ?? [])].reverse().slice(0, 10);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>专属模拟盘</Text>
        <TouchableOpacity onPress={reset} hitSlop={8}>
          <Text style={styles.reset}>重置</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {!profile || !acc ? (
          <Text style={styles.centerText}>加载中…</Text>
        ) : (
          <>
            <Text style={styles.title}>{profile.name}</Text>
            <Text style={styles.sub}>
              {profile.enabled && profile.autoTrade ? '自动交易已开启' : '自动交易未开启（仅手动触发时成交）'} · 独立于全局模拟盘
            </Text>

            <Card style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <SummaryCol label="可用资金" value={acc.cash.toFixed(2)} color={colors.text} />
                <SummaryCol label="持仓成本" value={posCost.toFixed(2)} color={colors.text} />
                <SummaryCol label="持仓数" value={String(acc.positions.length)} color={colors.up} />
              </View>
            </Card>

            <Section title={`当前持仓（${acc.positions.length}）`} />
            {acc.positions.length === 0 ? (
              <Card style={styles.emptyCard}>
                <Text style={styles.emptyText}>暂无持仓：开启自动交易后，策略信号 / 风控触发会自动在此账户下单。</Text>
              </Card>
            ) : (
              <Card padded={false} style={styles.listCard}>
                {acc.positions.map((p, i) => (
                  <View key={i} style={[styles.listRow, i > 0 && styles.hairline]}>
                    <View style={styles.rowLeft}>
                      <Text style={styles.rowName}>{toFullCode(p.symbol)}</Text>
                      <Text style={styles.rowSub}>
                        持仓 {p.shares} 股 · 可用 {p.available}
                      </Text>
                    </View>
                    <Text style={styles.rowRight}>{p.costPrice.toFixed(2)}</Text>
                  </View>
                ))}
              </Card>
            )}

            <Section title="最近成交" action={<Tag text={String(acc.trades.length)} variant="neutral" color={colors.info} />} />
            {recentTrades.length === 0 ? (
              <Card style={styles.emptyCard}>
                <Text style={styles.emptyText}>还没有成交记录。</Text>
              </Card>
            ) : (
              <Card padded={false} style={styles.listCard}>
                {recentTrades.map((t, i) => (
                  <View key={i} style={[styles.listRow, i > 0 && styles.hairline]}>
                    <View style={styles.rowLeft}>
                      <Text style={styles.rowName}>
                        {t.side === 'buy' ? '买入' : '卖出'} {t.quantity}股 {toFullCode(t.symbol)}
                      </Text>
                      <Text style={styles.rowSub}>{new Date(t.ts).toLocaleString('zh-CN')}</Text>
                    </View>
                    <Text style={[styles.rowRight, { color: t.side === 'buy' ? colors.up : colors.down }]}>
                      {t.price.toFixed(2)}
                    </Text>
                  </View>
                ))}
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function SummaryCol({ label, value, color }: { label: string; value: string; color: string }): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.summaryCol}>
      <Text style={[styles.summaryNum, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.md, paddingBottom: spacing.xxl },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
    back: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
    reset: { color: colors.warning, fontSize: fontSize.sm, fontWeight: '600' },
    headerTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold as any },
    title: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.heavy as any },
    sub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 4 },
    centerText: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center', paddingVertical: spacing.xl },

    summaryCard: { marginTop: spacing.md },
    summaryRow: { flexDirection: 'row' },
    summaryCol: { flex: 1, alignItems: 'center' },
    summaryNum: { fontSize: fontSize.md, fontWeight: fontWeight.heavy as any },
    summaryLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },

    listCard: { overflow: 'hidden' },
    listRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    rowLeft: { flex: 1, marginRight: spacing.sm },
    rowName: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
    rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 1 },
    rowRight: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold as any },
    hairline: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    emptyCard: { paddingVertical: spacing.lg },
    emptyText: { color: colors.textSecondary, fontSize: fontSize.xs, textAlign: 'center', lineHeight: 16 },
  });
}
