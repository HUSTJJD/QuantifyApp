/**
 * 启动动画（Splash）。
 *
 * 使用 React Native 核心 Animated API 驱动入场/退场（淡入 + 缩放），
 * 不引入额外原生动画依赖。动画时长/曲线由核心库处理，避免手写复杂动画逻辑。
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { colors, fontSize, spacing } from '@/theme';

interface Props {
  onFinish: () => void;
  /** 停留时长（ms） */
  duration?: number;
}

export function SplashScreen({ onFinish, duration = 1600 }: Props): React.JSX.Element {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.back(1.4)),
        useNativeDriver: true,
      }),
    ]).start();

    const hideTimer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 400,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1.05,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start(() => onFinish());
    }, duration);

    return () => clearTimeout(hideTimer);
  }, [duration, onFinish, opacity, scale]);

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.inner, { opacity, transform: [{ scale }] }]}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>量</Text>
        </View>
        <Text style={styles.title}>仙</Text>
        <Text style={styles.subtitle}>随缘</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  inner: { alignItems: 'center' },
  logo: {
    width: 84,
    height: 84,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logoText: { color: '#fff', fontSize: fontSize.title, fontWeight: '800' },
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: '800', marginBottom: spacing.xs },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.sm },
});
