/**
 * 策略快速回测：使用档案当前的全部编辑项（信号参数 / 止盈止损 / 移动止损 / 仓位比例 /
 * K线周期）对其选股池内的标的做本地历史回放，输出汇总指标与逐标的明细。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getProfile } from '@/quant/profileStore';
import type { StrategyProfile } from '@/quant/profile';
import { strategyOfProfile } from '@/quant/profile';
import type { BacktestResult } from '@/quant/backtest';
import { runBacktestOnSymbol } from '@/quant/backtestData';
import { getGroups } from '@/repositories/WatchlistRepository';
import type { Symbol } from '@/api';
import { displaySymbol } from '@/domain';
import { spacing, fontSize, radius, fontWeight } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { Card } from '@/components';

interface Row {
  symbol: Symbol;
  ok: boolean;
  result?: BacktestResult;
  reason?: string;
}

export function StrategyBacktestScreen({
  onBack,
  strategyId,
}: {
  onBack?: () => void;
  strategyId: string;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<StrategyProfile | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(true);
  const [note, setNote] = useState('');

  useEffect(() => {
    (async () => {
      const p = await getProfile(strategyId);
      if (!p) {
        setRunning(false);
        return;
      }
      setProfile(p);
      const groups = await getGroups();
      const seen = new Set<string>();
      const pool: Symbol[] = [];
      for (const g of groups) {
        for (const s of g.symbols ?? []) {
          const key = `${s.code}_${s.exchange}`;
          if (seen.has(key)) continue;
          seen.add(key);
          pool.push(s);
        }
      }
      const capped = pool.slice(0, 6);
      if (capped.length === 0) {
        setNote('选股池为空：先在自选股中添加股票，或等待该策略被启用后重试');
        setRunning(false);
        return;
      }
      const out: Row[] = [];
      for (const symbol of capped) {
        try {
          const result = await runBacktestOnSymbol(strategyOfProfile(p), symbol, {
            period: p.trade.period,
            count: 320,
            positionRatio: p.trade.positionRatio,
            exit: p.exit,
            initCash: 100_000,
          });
          out.push(result ? { symbol, ok: true, result } : { symbol, ok: false, reason: '历史数据不足' });
        } catch {
          out.push({ symbol, ok: false, reason: '数据拉取失败' });
        }
        setRows([...out]);
      }
      setNote(`数据量：最多回放近 ${capped.length} 只自选股 · ${capped.length < pool.length ? `（另有 ${pool.length - capped.length} 只未参与）` : ''}`);
      setRunning(false);
    })().catch(() => {
      setRunning(false);
    });
  }, [strategyId]);

  const styles = makeStyles(colors);
  const okRows = rows.filter((r) => r.ok && r.result);
  const avgRet = okRows.length > 0 ? okRows.reduce((s, r) => s + (r.result!.totalReturnPct ?? 0), 0) / okRows.length : 0;
  const avgWin = okRows.length > 0 ? okRows.reduce((s, r) => s + (r.result!.winRate ?? 0), 0) / okRows.length : 0;
  const avgDd = okRows.length > 0 ? okRows.reduce((s, r) => s + (r.result!.maxDrawdownPct ?? 0), 0) / okRows.length : 0;
  const totalTrades = okRows.reduce((s, r) => s + (r.result?.trades.length ?? 0), 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>快速回测</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {!profile ? (
          <Text style={styles.centerText}>策略不存在</Text>
        ) : (
          <>
            <Text style={styles.title}>{profile.name}</Text>
            <Text style={styles.desc}>信号参数 + 风控（止盈 {profile.exit.takeProfitPct || '关'}% · 止损 {profile.exit.stopLossPct || '关'}% · 移动止损 {profile.exit.trailingPct || '关'}%）</Text>

            <Card style={styles.summary}>
              <Text style={styles.summaryTitle}>{running ? '回测运行中，请稍候…' : `回测汇总（成功 ${okRows.length}/${rows.length}）`}</Text>
              {!running && okRows.length > 0 && (
                <View style={styles.statRow}>
                  <SummaryCol value={`${avgRet.toFixed(1)}%`} label="平均收益" color={avgRet >= 0 ? colors.up : colors.down} />
                  <SummaryCol value={`${avgWin.toFixed(0)}%`} label="平均胜率" color={colors.text} />
                  <SummaryCol value={`${avgDd.toFixed(1)}%`} label="平均回撤" color={colors.text} />
                  <SummaryCol value={String(totalTrades)} label="总成交" color={colors.text} />
                </View>
              )}
              {!running && okRows.length === 0 && <Text style={styles.desc}>没有可用的回测结果{note ? `（${note}）` : ''}</Text>}
              {note ? <Text style={styles.desc}>{note}</Text> : null}
            </Card>

            {rows.map((r, i) => {
              const ret = r.result?.totalReturnPct;
              const color = ret == null ? colors.textSecondary : ret >= 0 ? colors.up : colors.down;
              return (
                <Card key={i} padded={false} style={styles.rowCard}>
                  <View style={styles.rowMain}>
                    <View style={styles.rowLeft}>
                      <Text style={styles.rowName}>{displaySymbol(r.symbol)}</Text>
                      <Text style={styles.rowSub}>
                        {r.ok && r.result
                          ? `交易 ${r.result.trades.length} 笔 · 胜率 ${r.result.winRate.toFixed(0)}% · 回撤 ${r.result.maxDrawdownPct.toFixed(1)}%`
                          : r.reason ?? '失败'}
                      </Text>
                    </View>
                    {r.ok && r.result && (
                      <Text style={[styles.rowRet, { color }]}>
                        {(r.result.totalReturnPct >= 0 ? '+' : '') + r.result.totalReturnPct.toFixed(2)}%
                      </Text>
                    )}
                  </View>
                </Card>
              );
            })}

            <Text style={styles.hint}>
              提示：本地回测以收盘价近似撮合，忽略税费之外的滑点、停牌与交易时段限制；回测结果仅用于快速对比策略参数，不代表未来收益。
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function SummaryCol({ value, label, color }: { value: string; label: string; color: string }): React.JSX.Element {
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
    headerTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold as any },
    title: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.heavy as any },
    desc: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 4, lineHeight: 16 },
    centerText: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center', paddingVertical: spacing.xl },

    summary: { marginTop: spacing.md },
    summaryTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
    statRow: { flexDirection: 'row', marginTop: spacing.md },
    summaryCol: { flex: 1, alignItems: 'center' },
    summaryNum: { fontSize: fontSize.md + 2, fontWeight: fontWeight.heavy as any },
    summaryLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },

    rowCard: { marginTop: spacing.sm },
    rowMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.md },
    rowLeft: { flex: 1, marginRight: spacing.md },
    rowName: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
    rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    rowRet: { fontSize: fontSize.md, fontWeight: fontWeight.heavy as any },

    hint: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 16, marginTop: spacing.lg, paddingHorizontal: spacing.sm },
  });
}
