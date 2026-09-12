/**
 * 启动动画（Splash）。
 *
 * 用核心 Animated API + LinearGradient 组合出品牌化启动页：
 *  品牌色渐变底 + 呼吸光晕 → K 线图标弹入并逐根点亮 → 高光扫过 →
 *  英文名/品牌名/口号错峰上浮 → 底部三点加载 → 退场整体放大淡出。
 *
 * 采用固定品牌暗色，不跟随主题：主题模式是异步从本地存储读的，冷启动首帧尚不稳定，
 * 跟随主题会闪色；启动页本质是品牌展示，与主界面配色解耦也更合理。
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import { BRAND } from '@/theme/brand';
import { fontSize, fontWeight, zIndex } from '@/theme';

/** 启动页固定色板（与主题解耦；与 Ghostfolio 青绿品牌一致）。 */
const BG = ['#191919', '#1F2A2A', '#141818'] as const;
const LOGO = ['#6BF7F4', '#11BEBC', '#008583'] as const;
const TEXT = '#F5F7FA';
const TEXT_MUTED = 'rgba(245,247,250,0.62)';
const TEXT_FAINT = 'rgba(245,247,250,0.36)';

/** K 线图标几何：44×44 图标框内，bottom 为距底距离。 */
const CANDLES = [
  { bodyH: 10, bottom: 8, wickH: 20, bodyOpacity: 0.55 },
  { bodyH: 16, bottom: 12, wickH: 26, bodyOpacity: 0.72 },
  { bodyH: 12, bottom: 18, wickH: 24, bodyOpacity: 0.72 },
  { bodyH: 18, bottom: 20, wickH: 30, bodyOpacity: 1 },
];

interface Props {
  onFinish: () => void;
  /** 停留时长（ms） */
  duration?: number;
}

export function SplashScreen({ onFinish, duration = 1600 }: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();

  const rootOpacity = useRef(new Animated.Value(1)).current;
  const rootScale = useRef(new Animated.Value(1)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.62)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const titleY = useRef(new Animated.Value(16)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const sloganY = useRef(new Animated.Value(12)).current;
  const sloganOpacity = useRef(new Animated.Value(0)).current;
  const candles = useRef(CANDLES.map(() => new Animated.Value(0))).current;
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  // 用 ref 持有回调：避免父组件重渲染（onFinish 每次都是新函数）导致动画重启
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    const running: Animated.CompositeAnimation[] = [];

    // 图标弹入
    running.push(
      Animated.parallel([
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 720,
          easing: Easing.out(Easing.back(1.7)),
          useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );

    // 光晕呼吸
    running.push(
      Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ),
    );

    // 高光扫过图标（先延迟，扫完复位后再等下一轮）
    running.push(
      Animated.loop(
        Animated.sequence([
          Animated.delay(700),
          Animated.timing(shimmer, {
            toValue: 1,
            duration: 850,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(500),
          Animated.timing(shimmer, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );

    // K 线逐根点亮
    running.push(
      Animated.sequence([
        Animated.delay(180),
        Animated.stagger(
          90,
          candles.map(c =>
            Animated.timing(c, {
              toValue: 1,
              duration: 380,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ),
        ),
      ]),
    );

    // 品牌名 / 口号错峰上浮
    running.push(
      Animated.parallel([
        Animated.timing(titleY, { toValue: 0, duration: 560, delay: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(titleOpacity, { toValue: 1, duration: 520, delay: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
    );
    running.push(
      Animated.parallel([
        Animated.timing(sloganY, { toValue: 0, duration: 560, delay: 460, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(sloganOpacity, { toValue: 1, duration: 520, delay: 460, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
    );

    // 底部三点波动
    running.push(
      Animated.loop(
        Animated.stagger(
          170,
          dots.map(d =>
            Animated.sequence([
              Animated.timing(d, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }),
              Animated.timing(d, { toValue: 0, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }),
            ]),
          ),
        ),
      ),
    );

    running.forEach(a => a.start());

    // 退场：整体轻微放大并淡出
    const hideTimer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(rootOpacity, { toValue: 0, duration: 460, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(rootScale, { toValue: 1.06, duration: 460, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start(() => onFinishRef.current());
    }, duration);

    return () => {
      clearTimeout(hideTimer);
      running.forEach(a => a.stop());
    };
  }, [
    duration,
    onFinishRef,
    rootOpacity,
    rootScale,
    logoOpacity,
    logoScale,
    glow,
    shimmer,
    titleY,
    titleOpacity,
    sloganY,
    sloganOpacity,
    candles,
    dots,
  ]);

  const glowOpacity = useMemo(
    () => glow.interpolate({ inputRange: [0, 1], outputRange: [0.32, 0.78] }),
    [glow],
  );
  const glowScale = useMemo(
    () => glow.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1.2] }),
    [glow],
  );
  const shimmerX = useMemo(
    () => shimmer.interpolate({ inputRange: [0, 1], outputRange: [-100, 100] }),
    [shimmer],
  );

  return (
    <Animated.View style={[styles.root, { opacity: rootOpacity, transform: [{ scale: rootScale }] }]}>
      <LinearGradient colors={[...BG]} start={{ x: 0.15, y: 0 }} end={{ x: 0.85, y: 1 }} style={StyleSheet.absoluteFill} />

      {/* 呼吸光晕：主色 + 冷色两层，制造纵深 */}
      <Animated.View
        style={[
          styles.glow,
          styles.glowPrimary,
          { opacity: glowOpacity, transform: [{ scale: glowScale }] },
        ]}
      />
      <Animated.View
        style={[
          styles.glow,
          styles.glowCool,
          { opacity: glowOpacity, transform: [{ scale: glowScale }] },
        ]}
      />

      <View style={styles.content}>
        <Animated.View style={[styles.logoWrap, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
          <LinearGradient colors={[...LOGO]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logo}>
            <View style={styles.mark}>
              {CANDLES.map((c, i) => {
                const a = candles[i];
                return (
                  <Animated.View
                    key={i}
                    style={[
                      styles.candleCol,
                      {
                        left: i * 12,
                        opacity: a,
                        transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
                      },
                    ]}
                  >
                    <View style={[styles.wick, { height: c.wickH, bottom: c.bottom + c.bodyH / 2 - c.wickH / 2 }]} />
                    <View style={[styles.body, { height: c.bodyH, bottom: c.bottom, opacity: c.bodyOpacity }]} />
                  </Animated.View>
                );
              })}
            </View>
            <Animated.View
              style={[styles.shimmer, { transform: [{ rotate: '18deg' }, { translateX: shimmerX }] }]}
            />
          </LinearGradient>
        </Animated.View>

        <Animated.View style={[styles.titleWrap, { opacity: titleOpacity, transform: [{ translateY: titleY }] }]}>
          <Text style={styles.kicker}>{BRAND.shortName.toUpperCase()}</Text>
          <Text style={styles.name}>{BRAND.name}</Text>
        </Animated.View>

        <Animated.View style={[styles.sloganWrap, { opacity: sloganOpacity, transform: [{ translateY: sloganY }] }]}>
          <View style={styles.divider} />
          <Text style={styles.slogan}>{BRAND.slogan}</Text>
        </Animated.View>
      </View>

      <View style={[styles.dots, { bottom: insets.bottom + 48 }]}>
        {dots.map((d, i) => (
          <Animated.View
            key={i}
            style={[
              styles.dot,
              {
                opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.22, 1] }),
                transform: [{ scale: d.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1.25] }) }],
              },
            ]}
          />
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: zIndex.modal,
  },
  glow: { position: 'absolute', width: 320, height: 320, borderRadius: 160 },
  glowPrimary: { backgroundColor: 'rgba(229,72,77,0.16)' },
  glowCool: { backgroundColor: 'rgba(76,154,255,0.12)', top: -80, right: -110 },
  content: { alignItems: 'center' },
  logoWrap: {
    shadowColor: '#11BEBC',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 12,
    marginBottom: 26,
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  mark: { width: 44, height: 44 },
  candleCol: { position: 'absolute', width: 8, height: 44, bottom: 0 },
  wick: { position: 'absolute', left: 3, width: 2, borderRadius: 1, backgroundColor: '#FFFFFF' },
  body: { position: 'absolute', left: 0, width: 8, borderRadius: 2, backgroundColor: '#FFFFFF' },
  shimmer: {
    position: 'absolute',
    width: 34,
    height: 170,
    backgroundColor: 'rgba(255,255,255,0.26)',
  },
  titleWrap: { alignItems: 'center' },
  kicker: {
    color: TEXT_FAINT,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 6,
    paddingLeft: 6,
    marginBottom: 8,
  },
  name: {
    color: TEXT,
    fontSize: fontSize.display,
    fontWeight: fontWeight.heavy,
    letterSpacing: 8,
    paddingLeft: 8,
  },
  sloganWrap: { alignItems: 'center', marginTop: 18 },
  divider: {
    width: 26,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(245,247,250,0.22)',
    marginBottom: 14,
  },
  slogan: {
    color: TEXT_MUTED,
    fontSize: fontSize.sm,
    letterSpacing: 2,
    paddingLeft: 2,
  },
  dots: { position: 'absolute', flexDirection: 'row', alignItems: 'center' },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: TEXT_MUTED,
    marginHorizontal: 5,
  },
});
