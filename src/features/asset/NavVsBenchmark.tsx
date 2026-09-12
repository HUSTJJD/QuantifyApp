/** 组合净值 vs 基准（双线 + 超额指标） */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { marketData } from '@/data/api';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize } from '@/theme';
import { Card } from '@/components/ui/Card';
import { LineGraphView } from '@/components/LineGraphView';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icons } from '@/assets/icons';
import { alignByDate, computeBenchmarkMetrics } from '@/quant/benchmark';
import type { Candle, KlineParams } from '@/data/api';

export interface NavPoint {
  ts: number;
  total: number;
}

export function NavVsBenchmark({
  snapshots,
  benchmarkSymbol = { code: '000300', exchange: 'SH', name: '沪深300' },
  title = '净值 vs 基准',
}: {
  snapshots: NavPoint[];
  benchmarkSymbol?: { code: string; exchange: string; name?: string };
  title?: string;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const [bench, setBench] = useState<Candle[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (snapshots.length < 2) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const start = snapshots[0].ts;
    const end = snapshots[snapshots.length - 1].ts;
    marketData
      .getKline({
        symbol: benchmarkSymbol,
        period: 'day',
        adjust: 'none',
        startMs: start,
        endMs: end,
      } as KlineParams)
      .then((cs) => {
        if (!cancelled) setBench(cs ?? []);
      })
      .catch((e) => {
        if (!cancelled) {
          setBench([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [snapshots, benchmarkSymbol]);

  const { navSeries, benchSeries, metrics } = useMemo(() => {
    if (snapshots.length < 2) {
      return { navSeries: [] as number[], benchSeries: [] as number[], metrics: null };
    }
    const equity = snapshots.map((s) => s.total);
    const candles: Candle[] = snapshots.map((s) => ({
      datetime: s.ts,
      open: equity[0],
      high: equity[0],
      low: equity[0],
      close: equity[0],
      volume: 0,
    }));
    if (!bench || bench.length === 0) {
      const base = equity[0] || 1;
      return {
        navSeries: equity.map((v) => (v / base) * 100),
        benchSeries: [] as number[],
        metrics: null,
      };
    }
    const points = alignByDate(equity, candles, bench);
    const m = points.length >= 2 ? computeBenchmarkMetrics(points) : null;
    return {
      navSeries: points.map((p) => p.strategyNav),
      benchSeries: points.map((p) => p.benchmarkNav),
      metrics: m,
    };
  }, [snapshots, bench]);

  if (snapshots.length < 2) {
    return (
      <Card>
        <Text style={styles.title}>{title}</Text>
        <EmptyState text="快照不足" hint="至少两个交易日净值后可对比基准" icon={Icons.chart} />
      </Card>
    );
  }

  return (
    <Card>
      <Text style={styles.title}>{title}</Text>
      {loading ? (
        <Skeleton shape="chart" height={140} />
      ) : (
        <>
          <LineGraphView
            values={navSeries}
            times={benchSeries.length === navSeries.length ? snapshots.map((s) => s.ts) : snapshots.map((s) => s.ts)}
            height={160}
            trendingUp={metrics ? metrics.excessReturnPct >= 0 : navSeries[navSeries.length - 1] >= navSeries[0]}
            enablePanGesture
            enableGradient
          />
          {error ? <Text style={styles.err}>基准加载失败，仅显示组合净值</Text> : null}
          {benchSeries.length > 0 && (
            <Text style={styles.legend}>
              青绿=组合 · 灰= {benchmarkSymbol.name ?? '基准'}（归一化 100）
            </Text>
          )}
          {metrics && (
            <View style={styles.metrics}>
              <Metric label="组合" value={`${metrics.strategyReturnPct.toFixed(2)}%`} />
              <Metric label="基准" value={`${metrics.benchmarkReturnPct.toFixed(2)}%`} />
              <Metric
                label="超额"
                value={`${metrics.excessReturnPct.toFixed(2)}%`}
                color={metrics.excessReturnPct >= 0 ? colors.up : colors.down}
              />
              <Metric label="IR" value={metrics.informationRatio.toFixed(2)} />
            </View>
          )}
        </>
      )}
    </Card>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ color: color ?? colors.text, fontWeight: '700', fontSize: fontSize.md }}>{value}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: fontSize.xs }}>{label}</Text>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', marginBottom: spacing.sm },
    legend: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: spacing.xs },
    err: { color: colors.warning, fontSize: fontSize.xs, marginTop: spacing.xs },
    metrics: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.sm },
  });
}
