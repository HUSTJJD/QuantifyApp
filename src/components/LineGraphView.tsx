/**
 * LineGraphView —— 统一折线图（基于 react-native-graph / Skia）。
 * 支持单序列或双序列（策略 vs 基准）；Jest / 原生未就绪时回退 SVG Sparkline/Dual。
 *
 * 引擎探测为异步：首帧必走 SVG，避免 render 期同步 require worklets 炸红屏。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Sparkline } from './Sparkline';
import { DualLineChart } from './DualLineChart';
import { useAppTheme } from '@/theme/ThemeProvider';
import { getChartTheme } from '@/chart/theme';
import { isGraphAvailable, probeChartEngines } from '@/charts/availability';
import { spacing, fontSize } from '@/theme';

export interface LineGraphViewProps {
  /** 主序列（时间升序） */
  values: number[];
  /** 副序列（如基准，可选；与 values 等长时叠加） */
  valuesB?: number[];
  times?: number[];
  height?: number;
  /** 涨跌着色：true=up / false=down / null=primary */
  trendingUp?: boolean | null;
  color?: string;
  colorB?: string;
  labelA?: string;
  labelB?: string;
  enableGradient?: boolean;
  enablePanGesture?: boolean;
  /** 只画线、不画填充（双序列时建议主序列可填） */
  style?: object;
}

function toPoints(values: number[], times?: number[]) {
  return values.map((value, i) => ({
    value,
    date: new Date(times?.[i] ?? Date.now() - (values.length - 1 - i) * 86_400_000),
  }));
}

function useGraphEngine(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await probeChartEngines();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return ready && isGraphAvailable();
}

export function LineGraphView({
  values,
  valuesB,
  times,
  height = 160,
  trendingUp,
  color,
  colorB,
  labelA,
  labelB,
  enableGradient = true,
  enablePanGesture = true,
  style,
}: LineGraphViewProps): React.JSX.Element {
  const { mode } = useAppTheme();
  const theme = getChartTheme(mode);
  const lineColor =
    color ??
    (trendingUp === true ? theme.up : trendingUp === false ? theme.down : theme.active);
  const lineColorB = colorB ?? theme.textSecondary;

  const pointsA = useMemo(() => toPoints(values, times), [values, times]);
  const pointsB = useMemo(
    () => (valuesB && valuesB.length > 0 ? toPoints(valuesB, times) : null),
    [valuesB, times],
  );
  const available = useGraphEngine();
  const dual = !!(pointsB && pointsB.length >= 2);

  // 原生不可用：SVG 回退
  if (!available || values.length < 2) {
    return (
      <View style={[{ height }, style]}>
        {dual ? (
          <DualLineChart
            seriesA={values}
            seriesB={valuesB ?? []}
            labelA={labelA ?? '策略'}
            labelB={labelB ?? '基准'}
            colorA={lineColor}
            colorB={lineColorB}
            height={height}
          />
        ) : (
          <Sparkline data={values} height={height} color={lineColor} />
        )}
      </View>
    );
  }

  // available 为 true 时 graph 已探测成功；懒加载模块
  const { LineGraph } = require('react-native-graph') as typeof import('react-native-graph');

  return (
    <View style={[styles.wrap, { height: height + (labelA || labelB ? 18 : 0) }, style]}>
      <View style={[styles.canvas, { height }]}>
        {pointsB && (
          <LineGraph
            points={pointsB}
            color={lineColorB}
            lineThickness={1.5}
            animated
            enablePanGesture={false}
            style={StyleSheet.absoluteFill}
          />
        )}
        <LineGraph
          points={pointsA}
          color={lineColor}
          lineThickness={2}
          animated
          enablePanGesture={enablePanGesture && Platform.OS !== 'web'}
          enableIndicator={!dual}
          indicatorPulsating={!dual}
          gradientFillColors={
            enableGradient && !dual ? [lineColor + '55', lineColor + '00'] : undefined
          }
          style={StyleSheet.absoluteFill}
        />
      </View>
      {(labelA || labelB) && (
        <View style={styles.legend}>
          {labelA ? (
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: lineColor }]} />
              <Text style={styles.legendText}>{labelA}</Text>
            </View>
          ) : null}
          {labelB ? (
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: lineColorB }]} />
              <Text style={styles.legendText}>{labelB}</Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', overflow: 'hidden' },
  canvas: { width: '100%' },
  legend: { flexDirection: 'row', gap: spacing.md, marginTop: 4, paddingHorizontal: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  swatch: { width: 12, height: 3, borderRadius: 1 },
  legendText: { color: '#888', fontSize: fontSize.xs },
});

export default LineGraphView;
