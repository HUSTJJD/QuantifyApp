/**
 * Sparkline —— 基于 react-native-svg 的轻量走势折线，用于资产走势等非 K 线场景。
 *
 * 替代原 react-native-gifted-charts 的 LineChart；完全复用项目既有依赖，
 * 不引入新图表库。纯 SVG 绘制，跨平台稳定、可单测。
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg';
import { colors, fontSize } from '@/theme';

export interface SparklineProps {
  /** 数值序列（按时间升序） */
  data: number[];
  height?: number;
  color?: string;
  /** 是否显示最高/最低标注 */
  showBounds?: boolean;
}

export function Sparkline({
  data,
  height = 180,
  color = colors.primary,
  showBounds = true,
}: SparklineProps): React.JSX.Element {
  const width = 320; // 视图宽度，配合父容器 flex 实际由 svg 自适应
  const pad = 8;
  const innerH = height - pad * 2;

  if (!data || data.length < 2) {
    return (
      <View style={[styles.empty, { height }]}>
        <SvgText fontSize={fontSize.sm} fill={colors.textSecondary}>
          数据不足
        </SvgText>
      </View>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / (data.length - 1);

  const points = data
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + innerH - ((v - min) / range) * innerH;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const minIdx = data.indexOf(min);
  const maxIdx = data.indexOf(max);
  const minX = pad + minIdx * stepX;
  const maxX = pad + maxIdx * stepX;
  const minY = pad + innerH - ((min - min) / range) * innerH;
  const maxY = pad + innerH - ((max - min) / range) * innerH;

  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <Polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
      {showBounds && (
        <>
          <Line x1={minX} y1={minY} x2={minX} y2={height} stroke={colors.down} strokeWidth={0.5} strokeDasharray="3,3" />
          <Line x1={maxX} y1={maxY} x2={maxX} y2={height} stroke={colors.up} strokeWidth={0.5} strokeDasharray="3,3" />
          <SvgText x={Math.min(Math.max(minX, pad), width - 40)} y={minY - 4} fontSize={8} fill={colors.down}>
            {min.toFixed(0)}
          </SvgText>
          <SvgText x={Math.min(Math.max(maxX, pad), width - 40)} y={maxY - 4} fontSize={8} fill={colors.up}>
            {max.toFixed(0)}
          </SvgText>
        </>
      )}
    </Svg>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
});
