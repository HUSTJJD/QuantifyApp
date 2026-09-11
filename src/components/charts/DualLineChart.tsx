/**
 * DualLineChart —— 两条归一化净值折线（策略 vs 基准），轻量 SVG。
 * 输入两条等长序列（或各自独立），各自归一化到首点=100 后叠加绘制。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg';
import { colors, fontSize, spacing } from '@/theme';

export interface DualLineChartProps {
  seriesA: number[];
  seriesB?: number[];
  labelA?: string;
  labelB?: string;
  colorA?: string;
  colorB?: string;
  height?: number;
}

function toNav(series: number[]): number[] {
  if (!series || series.length === 0) return [];
  const base = series[0];
  if (!base || !Number.isFinite(base)) return series.map(() => 100);
  return series.map((v) => (v / base) * 100);
}

function polylineOf(data: number[], width: number, height: number, min: number, max: number): string {
  const pad = 8;
  const innerH = height - pad * 2;
  const range = max - min || 1;
  const stepX = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;
  return data
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + innerH - ((v - min) / range) * innerH;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export function DualLineChart({
  seriesA,
  seriesB,
  labelA = '策略',
  labelB = '基准',
  colorA = colors.primary,
  colorB = colors.textSecondary,
  height = 160,
}: DualLineChartProps): React.JSX.Element {
  const width = 320;
  const navA = toNav(seriesA);
  const navB = seriesB && seriesB.length > 0 ? toNav(seriesB) : [];

  if (navA.length < 2) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>数据不足</Text>
      </View>
    );
  }

  const all = navB.length > 0 ? [...navA, ...navB] : navA;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const midY = 8 + (height - 16) * (1 - (100 - min) / ((max - min) || 1));

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <Line x1={8} y1={midY} x2={width - 8} y2={midY} stroke={colors.border} strokeWidth={0.5} strokeDasharray="4,4" />
        <SvgText x={width - 48} y={midY - 4} fontSize={8} fill={colors.textSecondary}>
          基准=100
        </SvgText>
        {navB.length >= 2 && (
          <Polyline points={polylineOf(navB, width, height, min, max)} fill="none" stroke={colorB} strokeWidth={1.2} />
        )}
        <Polyline points={polylineOf(navA, width, height, min, max)} fill="none" stroke={colorA} strokeWidth={1.8} />
      </Svg>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: colorA }]} />
          <Text style={styles.legendText}>{labelA}</Text>
        </View>
        {navB.length >= 2 && (
          <View style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: colorB }]} />
            <Text style={styles.legendText}>{labelB}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textSecondary, fontSize: fontSize.sm },
  legend: { flexDirection: 'row', gap: spacing.md, marginTop: 4, paddingHorizontal: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  swatch: { width: 12, height: 3, borderRadius: 1 },
  legendText: { color: colors.textSecondary, fontSize: fontSize.xs },
});
