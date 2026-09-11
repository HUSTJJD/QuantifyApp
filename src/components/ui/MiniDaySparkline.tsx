/**
 * MiniDaySparkline —— 自选行内的紧凑日内迷你走势。
 * 用 Quote 的 prevClose/open/low/high/last 合成近似路径，无需拉 K 线。
 */
import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import type { Quote } from '@/data/api';

export function MiniDaySparkline({
  quote,
  width = 56,
  height = 28,
  color,
}: {
  quote: Quote;
  width?: number;
  height?: number;
  color?: string;
}): React.JSX.Element | null {
  const pts = useMemo(() => {
    const series = [quote.prevClose, quote.open, quote.low, quote.high, quote.last].filter(
      (v) => Number.isFinite(v) && v > 0,
    );
    if (series.length < 2) return null;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const range = max - min || 1;
    const pad = 2;
    const stepX = (width - pad * 2) / (series.length - 1);
    return series
      .map((v, i) => {
        const x = pad + i * stepX;
        const y = pad + (height - pad * 2) * (1 - (v - min) / range);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [quote, width, height]);

  if (!pts) return <View style={{ width, height }} />;

  const up = quote.last >= quote.prevClose;
  const stroke = color ?? (up ? '#F5465C' : '#2DCB73');

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.4} strokeLinejoin="round" />
    </Svg>
  );
}
