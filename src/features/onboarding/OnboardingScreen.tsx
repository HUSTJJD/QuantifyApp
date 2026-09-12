/**
 * 首启 Onboarding：3 屏可跳过。
 * 1 市场 → 2 风险风格 → 3 通知偏好。完成后写入 appPrefs。
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, fontWeight, layout, radius } from '@/theme';
import { setAppPrefs, type AppPrefs } from '@/settings/appPrefs';
import { BRAND } from '@/theme/brand';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';

type Market = 'A' | 'HK' | 'US';
type Risk = AppPrefs['riskStyle'];

const MARKETS: Array<{ key: Market; label: string; desc: string }> = [
  { key: 'A', label: 'A 股', desc: '沪深北 · T+1' },
  { key: 'HK', label: '港股', desc: '港交所 · T+0' },
  { key: 'US', label: '美股', desc: '纽交所/纳斯达克' },
];

const RISKS: Array<{ key: Risk; label: string; desc: string; template: string }> = [
  {
    key: 'conservative',
    label: '稳健',
    desc: '低仓位 · 严格止损',
    template: 'ma-cross',
  },
  {
    key: 'balanced',
    label: '平衡',
    desc: '默认仓位 · 信号确认',
    template: 'composite',
  },
  {
    key: 'aggressive',
    label: '进取',
    desc: '更高仓位 · 趋势跟随',
    template: 'macd-golden',
  },
];

export function OnboardingScreen({
  onDone,
}: {
  onDone: () => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [markets, setMarkets] = useState<Market[]>(['A']);
  const [risk, setRisk] = useState<Risk>('balanced');
  const [digest, setDigest] = useState(true);
  const [priceAlert, setPriceAlert] = useState(true);
  const styles = makeStyles(colors);

  const finish = async (skipped?: boolean) => {
    if (skipped) {
      await setAppPrefs({ hasOnboarded: true });
      onDone();
      return;
    }
    await setAppPrefs({
      hasOnboarded: true,
      marketPrefs: markets.length > 0 ? markets : ['A'],
      riskStyle: risk,
      notifyDigest: digest,
      notifyPriceAlert: priceAlert,
    });
    onDone();
  };

  const toggleMarket = (m: Market) => {
    setMarkets((cur) =>
      cur.includes(m) ? (cur.length === 1 ? cur : cur.filter((x) => x !== m)) : [...cur, m],
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.topRow}>
        <Text style={styles.brand}>{BRAND.name}</Text>
        <TouchableOpacity onPress={() => finish(true)} hitSlop={8}>
          <Text style={styles.skip}>跳过</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.dots}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {step === 0 && (
          <>
            <Text style={styles.title}>你主要关注哪个市场？</Text>
            <Text style={styles.subtitle}>用于默认指数与搜索优先级，可多选</Text>
            {MARKETS.map((m) => {
              const on = markets.includes(m.key);
              return (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.option, on && styles.optionOn]}
                  onPress={() => toggleMarket(m.key)}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.optionTitle, on && { color: colors.primary }]}>{m.label}</Text>
                    <Text style={styles.optionDesc}>{m.desc}</Text>
                  </View>
                  {on && <Icon name={Icons.check} size="md" color="primary" />}
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {step === 1 && (
          <>
            <Text style={styles.title}>你的交易风格？</Text>
            <Text style={styles.subtitle}>影响推荐策略模板与默认仓位上限</Text>
            {RISKS.map((r) => {
              const on = risk === r.key;
              return (
                <TouchableOpacity
                  key={r.key}
                  style={[styles.option, on && styles.optionOn]}
                  onPress={() => setRisk(r.key)}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.optionTitle, on && { color: colors.primary }]}>{r.label}</Text>
                    <Text style={styles.optionDesc}>{r.desc}</Text>
                  </View>
                  {on && <Icon name={Icons.check} size="md" color="primary" />}
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.title}>开启提醒？</Text>
            <Text style={styles.subtitle}>盘后摘要汇总今日扫描与信号，可随时在设置关闭</Text>
            <TouchableOpacity
              style={[styles.option, digest && styles.optionOn]}
              onPress={() => setDigest((v) => !v)}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionTitle, digest && { color: colors.primary }]}>盘后摘要</Text>
                <Text style={styles.optionDesc}>交易日 15:10 本地通知：扫描命中 / 信号 / 持仓异动</Text>
              </View>
              <Icon name={digest ? Icons.check : Icons.close} size="md" color={digest ? 'primary' : 'textSecondary'} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.option, priceAlert && styles.optionOn]}
              onPress={() => setPriceAlert((v) => !v)}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionTitle, priceAlert && { color: colors.primary }]}>价格/异动提醒</Text>
                <Text style={styles.optionDesc}>自选触及规则时站内提示</Text>
              </View>
              <Icon
                name={priceAlert ? Icons.check : Icons.close}
                size="md"
                color={priceAlert ? 'primary' : 'textSecondary'}
              />
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => {
            if (step < 2) setStep(step + 1);
            else void finish(false);
          }}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryText}>{step < 2 ? '下一步' : '开始使用'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    brand: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.heavy as any },
    skip: { color: colors.textSecondary, fontSize: fontSize.md },
    dots: { flexDirection: 'row', gap: 6, marginTop: spacing.lg, marginBottom: spacing.md },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.surfaceAlt,
    },
    dotActive: { backgroundColor: colors.primary, width: 18 },
    body: { paddingBottom: spacing.xl },
    title: {
      color: colors.text,
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold as any,
      marginBottom: spacing.xs,
    },
    subtitle: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      marginBottom: spacing.lg,
      lineHeight: 18,
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: layout.radiusCard,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      marginBottom: spacing.sm,
      gap: spacing.sm,
    },
    optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    optionTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
    optionDesc: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    footer: { paddingTop: spacing.sm },
    primaryBtn: {
      height: 48,
      borderRadius: radius.lg,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
  });
}
