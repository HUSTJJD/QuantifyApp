/**
 * Skeleton —— 脉冲占位块，用于首帧加载态（对齐 ghostfolio / OpenStock）。
 * 形状：line | card | chart。不引第三方骨架库，纯 Animated 实现。
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radius, spacing, duration } from '@/theme';

export type SkeletonShape = 'line' | 'card' | 'chart' | 'tile';

export function Skeleton({
  shape = 'line',
  width,
  height,
  style,
}: {
  shape?: SkeletonShape;
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: duration.slow, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: duration.slow, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  const h =
    height ?? (shape === 'card' ? 72 : shape === 'chart' ? 140 : shape === 'tile' ? 48 : 14);
  const w = width ?? (shape === 'line' ? '100%' : '100%');

  return (
    <Animated.View
      style={[
        styles.base,
        {
          width: w as ViewStyle['width'],
          height: h,
          borderRadius: shape === 'line' ? radius.sm : radius.md,
          backgroundColor: colors.surfaceAlt,
          opacity,
        },
        style,
      ]}
    />
  );
}

/** 列表骨架：n 行「左文右数」 */
export function SkeletonRows({
  rows = 4,
  style,
}: {
  rows?: number;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return (
    <View style={[{ gap: spacing.sm }, style]}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton shape="line" width={120} />
          <Skeleton shape="line" width={64} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
