/**
 * 盯盘告警规则管理页。
 * - 内置规则（涨跌幅/放量/突破/均线交叉/RSI）开关
 * - 用户自定义价格告警（上破/下破/涨跌幅）
 * - 策略信号告警按策略静音/开启
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  DEFAULT_ALERT_RULES,
  ALERT_TYPE_LABELS,
  type AlertRule,
  type AlertType,
} from './alerts';
import {
  getAllAlertRules,
  getUserAlertRules,
  addUserAlertRule,
  removeUserAlertRule,
  setDefaultRuleEnabled,
  getMutedSignalStrategies,
  setSignalAlertEnabled,
} from './userAlertRules';
import { getProfiles } from '@/quant/profileStore';
import type { StrategyProfile } from '@/quant/profile';
import { listLifecycle, reenableLifecycle, type AlertLifecycle } from './alertLifecycle';
import { marketData } from '@/data/api';
import { spacing, fontSize, fontWeight, radius } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { Card, Section, Toggle } from '@/components';

const USER_TYPES: { label: string; value: AlertType }[] = [
  { label: '价格上破', value: 'priceAbove' },
  { label: '价格下破', value: 'priceBelow' },
  { label: '涨跌幅≥', value: 'pct' },
];

function ruleSummary(r: AlertRule): string {
  switch (r.type) {
    case 'pct':
      return `涨跌幅 ≥ ${r.threshold}%`;
    case 'volumeSpike':
      return `成交量 ≥ ${r.threshold.toLocaleString('zh-CN')} 手`;
    case 'breakout':
      return `突破近 ${r.threshold} 根K线高点`;
    case 'priceAbove':
      return r.symbolKey ? `${r.symbolKey} ≥ ${r.threshold}` : `价格 ≥ ${r.threshold}`;
    case 'priceBelow':
      return r.symbolKey ? `${r.symbolKey} ≤ ${r.threshold}` : `价格 ≤ ${r.threshold}`;
    case 'maCross':
      return `MA${r.params?.fast ?? 5} × MA${r.params?.slow ?? 20} 金叉/死叉`;
    case 'rsiZone':
      return `RSI 超买>${r.params?.sell ?? r.threshold ?? 70} / 超卖<${r.params?.buy ?? 30}`;
    default:
      return '';
  }
}

export function AlertRulesScreen({ onBack }: { onBack?: () => void }): React.JSX.Element {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [rules, setRules] = useState<AlertRule[]>([]);
  const [userRules, setUserRules] = useState<AlertRule[]>([]);
  const [profiles, setProfiles] = useState<StrategyProfile[]>([]);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [formType, setFormType] = useState<AlertType>('priceAbove');
  const [formCode, setFormCode] = useState('');
  const [formExchange, setFormExchange] = useState('SH');
  const [formThreshold, setFormThreshold] = useState('');
  const [busy, setBusy] = useState(false);
  const [lifecycles, setLifecycles] = useState<AlertLifecycle[]>([]);

  const load = useCallback(async () => {
    const [all, user, ps, m, lives] = await Promise.all([
      getAllAlertRules(),
      getUserAlertRules(),
      getProfiles(),
      getMutedSignalStrategies(),
      listLifecycle(),
    ]);
    setRules(all.filter((r) => !r.id.startsWith('user_')));
    setUserRules(user);
    setProfiles(ps);
    setMuted(m);
    setLifecycles(lives.filter((l) => l.status === 'triggered' || l.status === 'expired').slice(0, 20));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
    }, [load]),
  );

  // 填入代码后预填阈值（OpenStock 模式）
  useEffect(() => {
    const code = formCode.trim();
    if (!code || formType === 'pct') return;
    let alive = true;
    const t = setTimeout(() => {
      marketData
        .getQuotes([{ code, exchange: formExchange as 'SH' | 'SZ' | 'BJ' }])
        .then((qs) => {
          const last = qs?.[0]?.last;
          if (!alive || !last || last <= 0) return;
          setFormThreshold((cur) => {
            if (cur.trim()) return cur;
            const base = formType === 'priceBelow' ? last * 0.95 : last * 1.05;
            return base.toFixed(2);
          });
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [formCode, formExchange, formType]);

  const toggleDefault = useCallback(
    async (id: string, next: boolean) => {
      setBusy(true);
      try {
        await setDefaultRuleEnabled(id, next);
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const onDeleteUser = useCallback(
    (id: string, label: string) => {
      Alert.alert('删除告警', `确认删除「${label}」？`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            removeUserAlertRule(id)
              .then(load)
              .catch(() => undefined);
          },
        },
      ]);
    },
    [load],
  );

  const onAdd = useCallback(async () => {
    const th = Number(formThreshold);
    if (!formCode.trim() || !Number.isFinite(th) || th <= 0) {
      Alert.alert('请填写完整', '标的代码与阈值为必填，阈值需为正数');
      return;
    }
    setBusy(true);
    try {
      const code = formCode.trim();
      const symbolKey = `${code}.${formExchange.toUpperCase()}`;
      await addUserAlertRule({
        type: formType,
        threshold: th,
        symbolKey,
      });
      setFormCode('');
      setFormThreshold('');
      await load();
    } finally {
      setBusy(false);
    }
  }, [formCode, formExchange, formThreshold, formType, load]);

  const toggleSignal = useCallback(
    async (id: string, enabled: boolean) => {
      await setSignalAlertEnabled(id, enabled);
      await load();
    },
    [load],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>盯盘告警</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {lifecycles.length > 0 && (
          <>
            <Section title="最近触发 / 静默" />
            <Card padded={false}>
              {lifecycles.map((l, i) => {
                const coolLeft = l.lastNotifiedAt
                  ? Math.max(
                      0,
                      Math.ceil(((l.cooldownSec ?? 300) * 1000 - (Date.now() - l.lastNotifiedAt)) / 1000),
                    )
                  : 0;
                return (
                  <View
                    key={`${l.ruleId}-${l.symbolKey}`}
                    style={[styles.row, i === lifecycles.length - 1 && styles.rowLast]}
                  >
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle}>{l.symbolKey}</Text>
                      <Text style={styles.rowDesc}>
                        {l.status === 'expired'
                          ? '已过期，不再通知'
                          : coolLeft > 0
                            ? `已触发 · 静默剩余 ${coolLeft}s`
                            : '已触发 · 可再次通知'}
                      </Text>
                    </View>
                    {l.status === 'triggered' ? (
                      <TouchableOpacity
                        onPress={() => {
                          reenableLifecycle(l.ruleId, l.symbolKey).then(load).catch(() => undefined);
                        }}
                      >
                        <Text style={{ color: colors.primary, fontWeight: '600' }}>恢复</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })}
            </Card>
          </>
        )}

        <Section title="内置规则" />
        <Card padded={false}>
          {rules.map((r, i) => {
            const def = DEFAULT_ALERT_RULES.find((d) => d.id === r.id);
            const on = r.enabled !== false;
            return (
              <View key={r.id} style={[styles.row, i === rules.length - 1 && styles.rowLast]}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{ALERT_TYPE_LABELS[r.type]}</Text>
                  <Text style={styles.rowDesc}>{ruleSummary(r)}</Text>
                  {def?.enabled === false && !on ? (
                    <Text style={styles.rowHint}>指标类默认关闭，开启后需本地已同步日K</Text>
                  ) : null}
                </View>
                <Toggle on={on} disabled={busy} onChange={(n) => toggleDefault(r.id, n)} />
              </View>
            );
          })}
        </Card>

        <Section title="自定义价格告警" />
        <Card>
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>类型</Text>
            <View style={styles.chipWrap}>
              {USER_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.value}
                  style={[styles.chip, formType === t.value && styles.chipActive]}
                  onPress={() => setFormType(t.value)}
                >
                  <Text style={[styles.chipText, formType === t.value && styles.chipTextActive]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>代码</Text>
            <TextInput
              style={styles.input}
              value={formCode}
              onChangeText={setFormCode}
              placeholder="600519"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="characters"
            />
            <View style={[styles.chipWrap, { marginLeft: spacing.sm }]}>
              {['SH', 'SZ', 'BJ'].map((ex) => (
                <TouchableOpacity
                  key={ex}
                  style={[styles.chipSm, formExchange === ex && styles.chipActive]}
                  onPress={() => setFormExchange(ex)}
                >
                  <Text style={[styles.chipText, formExchange === ex && styles.chipTextActive]}>{ex}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>阈值</Text>
            <TextInput
              style={styles.input}
              value={formThreshold}
              onChangeText={setFormThreshold}
              placeholder={formType === 'pct' ? '5' : '100.00'}
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
            />
            <TouchableOpacity style={[styles.addBtn, busy && { opacity: 0.5 }]} onPress={() => onAdd().catch(() => undefined)} disabled={busy}>
              <Text style={styles.addBtnText}>添加</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {userRules.length > 0 && (
          <Card padded={false} style={{ marginTop: spacing.sm }}>
            {userRules.map((r, i) => (
              <View key={r.id} style={[styles.row, i === userRules.length - 1 && styles.rowLast]}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{ALERT_TYPE_LABELS[r.type]}</Text>
                  <Text style={styles.rowDesc}>{ruleSummary(r)}</Text>
                </View>
                <TouchableOpacity onPress={() => onDeleteUser(r.id, ruleSummary(r))} hitSlop={8}>
                  <Text style={styles.delete}>删除</Text>
                </TouchableOpacity>
              </View>
            ))}
          </Card>
        )}

        <Section title="策略信号告警" />
        <Card padded={false}>
          {profiles.length === 0 ? (
            <View style={styles.row}>
              <Text style={styles.rowDesc}>暂无策略档案，请先在「策略」页创建</Text>
            </View>
          ) : (
            profiles.map((p, i) => {
              const on = !muted.has(p.id);
              return (
                <View key={p.id} style={[styles.row, i === profiles.length - 1 && styles.rowLast]}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{p.name}</Text>
                    <Text style={styles.rowDesc}>买入/卖出信号推送 · {p.enabled ? '策略已启用' : '策略已停用（仍可单独告警）'}</Text>
                  </View>
                  <Toggle on={on} onChange={(n) => toggleSignal(p.id, n)} />
                </View>
              );
            })
          )}
        </Card>

        <Text style={styles.hint}>
          告警在交易时段前台轮询时触发，同标的同规则当日只提醒一次。均线/RSI 依赖本地已同步日K。
        </Text>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.md, paddingBottom: spacing.xxl },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    back: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
    headerTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold as any },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowLast: { borderBottomWidth: 0 },
    rowText: { flex: 1, marginRight: spacing.md },
    rowTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
    rowDesc: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    rowHint: { color: colors.warning, fontSize: fontSize.xs, marginTop: 2 },

    formRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    formLabel: { color: colors.textSecondary, fontSize: fontSize.xs, width: 36 },
    input: {
      flex: 1,
      minWidth: 80,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      fontSize: fontSize.sm,
      color: colors.text,
      backgroundColor: colors.surfaceAlt,
    },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    chipSm: {
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.text, fontSize: fontSize.xs },
    chipTextActive: { color: '#fff', fontWeight: '700' },
    addBtn: {
      marginLeft: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
    },
    addBtnText: { color: '#fff', fontSize: fontSize.sm, fontWeight: '600' },
    delete: { color: colors.down, fontSize: fontSize.sm, fontWeight: '600' },
    hint: {
      color: colors.textSecondary,
      fontSize: fontSize.xs,
      lineHeight: 16,
      marginTop: spacing.lg,
      paddingHorizontal: spacing.xs,
    },
  });
}
