/**
 * 回测演示页（M5 可视化）。拉取标的日 K，跑 MA 金叉策略回测，展示
 * 权益曲线（Sparkline）+ 绩效卡片（收益率/最大回撤/夏普/胜率）。
 * 后续可扩展为策略选择 + 区间选择 + 报告导出。
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKline } from '@/hooks/useMarketData';
import { displaySymbol } from '@/domain';
import type { Symbol, KlinePeriod } from '@/data/api';
import { LineGraphView, Card, Section, StatTile } from '@/components';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, fontWeight } from '@/theme';
import { runBacktest } from '@/quant/backtest';
import { walkForward } from '@/quant/walkForward';
import { activeStrategies } from '@/quant/strategies';

const TARGET: Symbol = { code: '600519', exchange: 'SH', name: '贵州茅台' };
const PERIOD: KlinePeriod = 'day';

export function BacktestScreen({ onBack }: { onBack?: () => void }): React.JSX.Element {
  const { colors: c } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { data: kline, loading, error } = useKline({ symbol: TARGET, period: PERIOD, count: 250 });

  const result = useMemo(() => {
    if (!kline || kline.length < 30) return null;
    const strat = activeStrategies({
      enabled: { trend_confirm: true },
    })[0];
    return runBacktest(strat, kline, { initCash: 100_000 });
  }, [kline]);

  const wf = useMemo(() => {
    if (!kline || kline.length < 50) return null;
    const strat = activeStrategies({
      enabled: { trend_confirm: true },
    })[0];
    return walkForward(strat, kline, { initCash: 100_000, trainRatio: 0.7 });
  }, [kline]);

  const styles = makeStyles(c);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom }]}
    >
      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity onPress={onBack}>
            <Text style={styles.back}>‹ 返回</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>回测 · {displaySymbol(TARGET, TARGET.name)}</Text>
      </View>

      {loading && <Text style={styles.hint}>K线加载中…</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      {result && (
        <>
          <Card style={styles.chartCard}>
            <View style={styles.chartHead}>
              <Icon name={Icons.chart} size={2} color="primary" style={styles.chartHeadIcon} />
              <Text style={styles.chartHeadText}>权益曲线（MA金叉 · 全仓）</Text>
            </View>
            <LineGraphView
              values={result.equity}
              height={160}
              trendingUp={result.totalReturnPct >= 0}
              enablePanGesture
            />
          </Card>

          <Section title="绩效" />
          <Card>
            <View style={styles.statRow}>
              <StatTile value={`${result.totalReturnPct.toFixed(2)}%`} label="总收益率" color={result.totalReturnPct >= 0 ? c.up : c.down} />
              <StatTile value={`${result.annualizedReturnPct.toFixed(2)}%`} label="年化收益" color={result.annualizedReturnPct >= 0 ? c.up : c.down} />
            </View>
            <View style={styles.statRow}>
              <StatTile value={`${result.maxDrawdownPct.toFixed(2)}%`} label="最大回撤" color={c.warning} />
              <StatTile value={result.sharpe.toFixed(2)} label="夏普比率" />
            </View>
            <View style={styles.statRow}>
              <StatTile value={`${result.winRate.toFixed(1)}%`} label="胜率" />
              <StatTile value={result.profitFactor === Infinity ? '∞' : result.profitFactor.toFixed(2)} label="盈亏比" />
            </View>
            <View style={styles.statRow}>
              <StatTile value={result.trades.length} label="交易次数" />
              <StatTile value={`¥${result.totalFees.toFixed(0)}`} label="总费用" />
            </View>
          </Card>

          {wf && (
            <>
              <Section title="样本外验证（70/30）" />
              <Card>
                <View style={styles.statRow}>
                  <StatTile value={`${wf.train.totalReturnPct.toFixed(2)}%`} label="训练集收益" color={wf.train.totalReturnPct >= 0 ? c.up : c.down} />
                  <StatTile value={`${wf.val.totalReturnPct.toFixed(2)}%`} label="验证集收益" color={wf.val.totalReturnPct >= 0 ? c.up : c.down} />
                </View>
                <View style={styles.statRow}>
                  <StatTile value={wf.train.sharpe.toFixed(2)} label="训练集夏普" />
                  <StatTile value={wf.val.sharpe.toFixed(2)} label="验证集夏普" />
                </View>
                <View style={styles.statRow}>
                  <StatTile value={`${wf.returnDecayPct.toFixed(1)}%`} label="收益衰减" color={wf.returnDecayPct > 50 ? c.down : undefined} />
                  <StatTile value={`${wf.sharpeDecayPct.toFixed(1)}%`} label="夏普衰减" color={wf.sharpeDecayPct > 50 ? c.down : undefined} />
                </View>
                {wf.likelyOverfit && (
                  <Text style={styles.overfitWarn}>疑似过拟合：验证集表现显著差于训练集，策略参数可能过度拟合历史数据</Text>
                )}
              </Card>
            </>
          )}
        </>
      )}

      {!loading && !error && !result && (
        <Text style={styles.hint}>K线数据不足，无法回测</Text>
      )}
    </ScrollView>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
    back: { color: colors.primary, fontSize: fontSize.md, marginRight: spacing.sm },
    title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
    hint: { color: colors.textSecondary, fontSize: fontSize.sm, paddingVertical: spacing.md, textAlign: 'center' },
    error: { color: colors.down, fontSize: fontSize.sm, paddingVertical: spacing.md, textAlign: 'center' },
    chartCard: { marginBottom: spacing.md },
    chartHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
    chartHeadIcon: { marginRight: spacing.xs },
    chartHeadText: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold as any },
    statRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: spacing.sm },
    overfitWarn: { color: colors.down, fontSize: fontSize.xs, textAlign: 'center', marginTop: spacing.xs, lineHeight: 16 },
  });
}
