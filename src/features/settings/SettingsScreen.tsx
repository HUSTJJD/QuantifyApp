/**
 * 设置页：外观 / 行情 / 交易默认值 / 数据源 / API Key / 本地库 / 缓存 / 关于。
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { marketData } from '@/data/api';
import { getApiConfig } from '@/data/api';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { spacing, fontSize, radius } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { Toggle } from '@/components';
import {
  getAppPrefs,
  setAppPrefs,
  primeAppPrefs,
  DEFAULT_PREFS,
  type AppPrefs,
} from '@/settings/appPrefs';
import { quoteFeed } from '@/data/QuoteFeed';
import { quantStore } from '@/data/db/QuantStore';
import { fireDigestNow } from '@/features/notify/localDigest';
import { fireDigestAlert } from '@/features/notify/DigestBridge';
import {
  getChannelPrefs,
  setChannelPrefs,
  sendTestNotify,
  type NotifyChannelPrefs,
} from '@/features/notify/channels';

const INTERVAL_OPTIONS = [3, 5, 10, 15, 30];
const RATIO_OPTIONS = [
  { label: '1/4', value: 0.25 },
  { label: '1/3', value: 1 / 3 },
  { label: '1/2', value: 0.5 },
  { label: '全仓', value: 1 },
];
const CASH_OPTIONS = [50_000, 100_000, 200_000, 500_000, 1_000_000];
const APP_VERSION = '0.1.0';

export function SettingsScreen({
  onBack,
  onOpenDebug,
  onOpenApiStats,
}: {
  onBack: () => void;
  onOpenDebug?: () => void;
  onOpenApiStats?: () => void;
}): React.JSX.Element {
  const { mode, toggle, colors, upDownScheme, setUpDownScheme } = useAppTheme();
  const [sources, setSources] = useState<{ id: string; label: string }[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [prefs, setPrefs] = useState<AppPrefs>({ ...DEFAULT_PREFS });
  const [clearing, setClearing] = useState(false);
  const [channels, setChannels] = useState<NotifyChannelPrefs | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const insets = useSafeAreaInsets();
  const { stats, running, progress, lastSyncAt, triggerSync, refreshStats } = useSyncStatus();
  const styles = makeStyles(colors);

  const loadSettings = useCallback(() => {
    setSources(marketData.listSources());
    setSelected(getApiConfig().sourceOrder[0] ?? '');
  }, []);

  useEffect(() => {
    loadSettings();
    getAppPrefs().then((p) => {
      setPrefs(p);
      primeAppPrefs(p);
    });
    getChannelPrefs().then((c) => {
      setChannels(c);
      setWebhookUrl(c.webhookUrl);
    });
  }, [loadSettings]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      loadSettings();
      refreshStats();
      const p = await getAppPrefs();
      setPrefs(p);
      primeAppPrefs(p);
    } finally {
      setRefreshing(false);
    }
  }, [loadSettings, refreshStats]);

  const savePrefs = useCallback(async (patch: Partial<AppPrefs>) => {
    const next = await setAppPrefs(patch);
    primeAppPrefs(next);
    setPrefs(next);
    if (patch.quoteIntervalSec !== undefined) quoteFeed.applyPollInterval();
  }, []);

  const onSelectSource = async (id: string) => {
    setSelected(id);
    await marketData.setPreferredSource(id);
  };

  const onSaveKey = async () => {
    setSaving(true);
    try {
      await marketData.setApiKey(apiKey.trim());
      Alert.alert('已保存', '同花顺 API Key 已保存到本机，请重启应用后生效');
    } finally {
      setSaving(false);
    }
  };

  const onClearCaches = () => {
    Alert.alert('清理缓存', '将清空过期方法缓存与行情内存缓存，不影响本地K线库与自选。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清理',
        style: 'destructive',
        onPress: () => {
          setClearing(true);
          (async () => {
            try {
              await quantStore().clearAllMethodCache();
              quoteFeed.refreshNow().catch(() => undefined);
              Alert.alert('已清理', '过期缓存已删除');
            } catch {
              Alert.alert('清理失败', '请稍后重试');
            } finally {
              setClearing(false);
            }
          })();
        },
      },
    ]);
  };

  const onResetPrefs = () => {
    Alert.alert('恢复默认偏好', '行情间隔、仓位、初始资金等将恢复默认。', [
      { text: '取消', style: 'cancel' },
      {
        text: '恢复',
        onPress: () => {
          savePrefs({ ...DEFAULT_PREFS }).catch(() => undefined);
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
      }
    >
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.title}>设置</Text>
      </View>

      <Text style={styles.sectionTitle}>外观</Text>
      <View style={styles.themeRow}>
        <Text style={styles.sourceLabel}>深色模式</Text>
        <Toggle on={mode === 'dark'} onChange={() => toggle()} />
      </View>
      <Text style={styles.fieldLabel}>涨跌色</Text>
      <View style={styles.chipRow}>
        {(
          [
            { key: 'cn', label: '红涨绿跌' },
            { key: 'intl', label: '绿涨红跌' },
            { key: 'colorblind', label: '蓝涨橙跌' },
          ] as const
        ).map((o) => (
          <TouchableOpacity
            key={o.key}
            style={[styles.chip, upDownScheme === o.key && styles.chipActive]}
            onPress={() => setUpDownScheme(o.key)}
          >
            <Text style={[styles.chipText, upDownScheme === o.key && styles.chipTextActive]}>
              {o.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionTitle}>通知</Text>
      <View style={styles.themeRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sourceLabel}>盘后摘要</Text>
          <Text style={styles.sectionHint}>交易日到点后汇总扫描/信号</Text>
        </View>
        <Toggle on={prefs.notifyDigest} onChange={() => savePrefs({ notifyDigest: !prefs.notifyDigest })} />
      </View>
      {prefs.notifyDigest && (
        <View style={styles.chipRow}>
          {['15:05', '15:10', '15:30', '16:00'].map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.chip, prefs.notifyDigestTime === t && styles.chipActive]}
              onPress={() => savePrefs({ notifyDigestTime: t })}
            >
              <Text style={[styles.chipText, prefs.notifyDigestTime === t && styles.chipTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.chip, { borderColor: colors.primary, borderWidth: 1 }]}
            onPress={async () => {
              const c = await fireDigestNow();
              fireDigestAlert(c.title, c.body);
            }}
          >
            <Text style={[styles.chipText, { color: colors.primary }]}>试发</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.themeRow}>
        <Text style={styles.sourceLabel}>价格/异动提醒</Text>
        <Toggle
          on={prefs.notifyPriceAlert}
          onChange={() => savePrefs({ notifyPriceAlert: !prefs.notifyPriceAlert })}
        />
      </View>

      <Text style={styles.sectionTitle}>通知通道</Text>
      {channels && (
        <>
          <View style={styles.themeRow}>
            <Text style={styles.sourceLabel}>应用内</Text>
            <Toggle
              on={channels.inApp}
              onChange={async () => {
                const n = await setChannelPrefs({ inApp: !channels.inApp });
                setChannels(n);
              }}
            />
          </View>
          <View style={styles.themeRow}>
            <Text style={styles.sourceLabel}>Webhook（Telegram/Bark）</Text>
            <Toggle
              on={channels.webhook}
              onChange={async () => {
                const n = await setChannelPrefs({ webhook: !channels.webhook });
                setChannels(n);
              }}
            />
          </View>
          {channels.webhook && (
            <TextInput
              value={webhookUrl}
              onChangeText={setWebhookUrl}
              onBlur={async () => {
                const n = await setChannelPrefs({ webhookUrl: webhookUrl.trim() });
                setChannels(n);
              }}
              placeholder="https://…"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
            />
          )}
          <TouchableOpacity
            style={[styles.themeRow, { paddingVertical: spacing.sm }]}
            onPress={async () => {
              try {
                await sendTestNotify();
                Alert.alert('已发送', '请检查已启用的通道');
              } catch (e) {
                Alert.alert('试发失败', e instanceof Error ? e.message : String(e));
              }
            }}
          >
            <Text style={[styles.sourceLabel, { color: colors.primary }]}>试发通知</Text>
          </TouchableOpacity>
        </>
      )}

      <TouchableOpacity
        style={[styles.themeRow, { paddingVertical: spacing.sm }]}
        onPress={() => {
          savePrefs({ hasOnboarded: false }).then(() => {
            Alert.alert('已重置引导', '重启应用后将重新进入首启引导');
          });
        }}
      >
        <Text style={styles.sourceLabel}>重新首启引导</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>行情刷新</Text>
      <Text style={styles.sectionHint}>交易时段内轮询间隔；间隔越短越费电与接口配额。</Text>
      <View style={styles.chipRow}>
        {INTERVAL_OPTIONS.map((sec) => (
          <TouchableOpacity
            key={sec}
            style={[styles.chip, prefs.quoteIntervalSec === sec && styles.chipActive]}
            onPress={() => savePrefs({ quoteIntervalSec: sec })}
          >
            <Text style={[styles.chipText, prefs.quoteIntervalSec === sec && styles.chipTextActive]}>{sec}s</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionTitle}>交易默认值</Text>
      <Text style={styles.sectionHint}>新建策略档案与快速回测时的默认参数。</Text>
      <Text style={styles.fieldLabel}>默认单笔仓位</Text>
      <View style={styles.chipRow}>
        {RATIO_OPTIONS.map((o) => (
          <TouchableOpacity
            key={o.label}
            style={[styles.chip, Math.abs(prefs.defaultPositionRatio - o.value) < 0.01 && styles.chipActive]}
            onPress={() => savePrefs({ defaultPositionRatio: o.value })}
          >
            <Text style={[styles.chipText, Math.abs(prefs.defaultPositionRatio - o.value) < 0.01 && styles.chipTextActive]}>
              {o.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.fieldLabel}>默认信号K线</Text>
      <View style={styles.chipRow}>
        {(['day', '60m', '30m', '15m', '5m'] as const).map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.chip, prefs.defaultSignalPeriod === p && styles.chipActive]}
            onPress={() => savePrefs({ defaultSignalPeriod: p })}
          >
            <Text style={[styles.chipText, prefs.defaultSignalPeriod === p && styles.chipTextActive]}>
              {p === 'day' ? '日K' : p}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.fieldLabel}>回测初始资金（元）</Text>
      <View style={styles.chipRow}>
        {CASH_OPTIONS.map((v) => (
          <TouchableOpacity
            key={v}
            style={[styles.chip, prefs.defaultInitCash === v && styles.chipActive]}
            onPress={() => savePrefs({ defaultInitCash: v })}
          >
            <Text style={[styles.chipText, prefs.defaultInitCash === v && styles.chipTextActive]}>
              {v >= 10000 ? `${v / 10000}万` : v}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionTitle}>首页模块</Text>
      <View style={styles.themeRow}>
        <Text style={styles.sourceLabel}>热股榜</Text>
        <Toggle on={prefs.showHotStocks} onChange={(n) => savePrefs({ showHotStocks: n })} />
      </View>
      <View style={styles.themeRow}>
        <Text style={styles.sourceLabel}>涨跌停概览</Text>
        <Toggle on={prefs.showLimitBoard} onChange={(n) => savePrefs({ showLimitBoard: n })} />
      </View>
      <View style={styles.themeRow}>
        <Text style={styles.sourceLabel}>大盘资金流</Text>
        <Toggle on={prefs.showFundFlow} onChange={(n) => savePrefs({ showFundFlow: n })} />
      </View>
      <View style={styles.themeRow}>
        <Text style={styles.sourceLabel}>盘中资金流排行</Text>
        <Toggle on={prefs.showFundFlowRanks} onChange={(n) => savePrefs({ showFundFlowRanks: n })} />
      </View>
      <View style={styles.themeRow}>
        <Text style={styles.sourceLabel}>北向 / 两融</Text>
        <Toggle on={prefs.showMarketPulse} onChange={(n) => savePrefs({ showMarketPulse: n })} />
      </View>
      <View style={styles.themeRow}>
        <Text style={styles.sourceLabel}>今日异动</Text>
        <Toggle on={prefs.showTodaySurge} onChange={(n) => savePrefs({ showTodaySurge: n })} />
      </View>

      <Text style={styles.sectionTitle}>数据源（可自由切换后端）</Text>
      <Text style={styles.sectionHint}>
        数据优先级：fuyao 官方主源 › 同花顺 REST › stock-sdk 兜底。你可选择任意已注册后端作为主源。
      </Text>
      {sources.map((s) => (
        <TouchableOpacity
          key={s.id}
          style={[styles.sourceRow, selected === s.id && styles.sourceRowActive]}
          onPress={() => onSelectSource(s.id)}
        >
          <Text style={styles.sourceLabel}>{s.label}</Text>
          <Text style={[styles.radio, selected === s.id && styles.radioOn]}>{selected === s.id ? '●' : '○'}</Text>
        </TouchableOpacity>
      ))}

      <Text style={styles.sectionTitle}>同花顺 API Key</Text>
      <Text style={styles.sectionHint}>Key 仅保存在你的设备上，不会上传。留空则使用测试环境变量。</Text>
      <TextInput
        style={styles.input}
        placeholder="粘贴你的 X-api-key"
        placeholderTextColor={colors.textSecondary}
        value={apiKey}
        onChangeText={setApiKey}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      <TouchableOpacity
        style={[styles.btn, saving && styles.btnDisabled]}
        onPress={onSaveKey}
        disabled={saving || !apiKey.trim()}
      >
        <Text style={styles.btnText}>{saving ? '保存中…' : '保存 Key'}</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>本地数据（量化库）</Text>
      <Text style={styles.sectionHint}>
        全市场标的与日 K 增量同步。「日K根数」= 标的 × 历史K线总行数（5000 标的 × 近 20 根 ≈ 10 万），不是标的家数。
      </Text>
      <View style={styles.statRow}>
        <StatItem label="标的" value={String(stats.tickers)} colors={colors} />
        <StatItem label="日K根数" value={fmtCount(stats.klineRows)} colors={colors} />
        <StatItem label="复权因子" value={String(stats.factors)} colors={colors} />
        <StatItem label="已同步" value={String(stats.synced)} colors={colors} />
      </View>
      {lastSyncAt > 0 && (
        <Text style={styles.statHint}>上次同步：{new Date(lastSyncAt).toLocaleString('zh-CN')}</Text>
      )}
      {running && progress && (
        <Text style={styles.statHint}>
          同步中 {progress.done}/{progress.total}（跳过 {progress.skipped}，失败 {progress.failed}）
        </Text>
      )}
      <TouchableOpacity
        style={[styles.btn, running && styles.btnDisabled]}
        onPress={triggerSync}
        disabled={running}
      >
        <Text style={styles.btnText}>{running ? '同步中…' : '立即同步'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.btnGhost, clearing && styles.btnDisabled]} onPress={onClearCaches} disabled={clearing}>
        <Text style={styles.btnGhostText}>{clearing ? '清理中…' : '清理过期缓存'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.btnGhost} onPress={onResetPrefs}>
        <Text style={styles.btnGhostText}>恢复默认偏好</Text>
      </TouchableOpacity>

      {onOpenDebug && (
        <>
          <Text style={styles.sectionTitle}>调试</Text>
          <TouchableOpacity style={styles.sourceRow} onPress={onOpenApiStats}>
            <Text style={styles.sourceLabel}>行情源统计</Text>
            <Text style={styles.radio}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sourceRow} onPress={onOpenDebug}>
            <Text style={styles.sourceLabel}>调试日志</Text>
            <Text style={styles.radio}>›</Text>
          </TouchableOpacity>
        </>
      )}

      <Text style={styles.sectionTitle}>关于</Text>
      <View style={styles.aboutBox}>
        <Text style={styles.aboutTitle}>QuantifyApp</Text>
        <Text style={styles.aboutDesc}>版本 {APP_VERSION} · 本地优先的个人量化工具</Text>
        <Text style={styles.aboutDesc}>数据源：同花顺官方 SDK / REST · stock-sdk 兜底</Text>
        <Text style={styles.aboutDesc}>所有偏好与持仓仅保存在本机</Text>
      </View>
    </ScrollView>
  );
}

function StatItem({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useAppTheme>['colors'];
}): React.JSX.Element {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        paddingVertical: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.sm,
        marginRight: spacing.xs,
      }}
    >
      <Text style={{ color: colors.text, fontSize: fontSize.md, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function fmtCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.md },
    topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
    back: { color: colors.primary, fontSize: fontSize.md, marginRight: spacing.md },
    title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
    sectionTitle: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: '700',
      marginTop: spacing.lg,
      marginBottom: spacing.xs,
    },
    sectionHint: { color: colors.textSecondary, fontSize: fontSize.xs, marginBottom: spacing.sm },
    fieldLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginBottom: spacing.xs, marginTop: spacing.xs },
    statRow: { flexDirection: 'row', marginBottom: spacing.xs },
    statHint: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: spacing.xs },
    themeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      marginBottom: spacing.sm,
      backgroundColor: colors.surface,
    },
    sourceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      marginBottom: spacing.xs,
      backgroundColor: colors.surface,
    },
    sourceRowActive: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
    sourceLabel: { color: colors.text, fontSize: fontSize.md },
    radio: { color: colors.textSecondary, fontSize: fontSize.lg },
    radioOn: { color: colors.primary },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.text, fontSize: fontSize.sm },
    chipTextActive: { color: '#fff', fontWeight: '700' },
    input: {
      backgroundColor: colors.surface,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      padding: spacing.sm,
      fontSize: fontSize.md,
    },
    btn: {
      backgroundColor: colors.primary,
      borderRadius: radius.sm,
      paddingVertical: spacing.sm,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    btnGhost: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      paddingVertical: spacing.sm,
      alignItems: 'center',
      marginTop: spacing.sm,
      backgroundColor: colors.surface,
    },
    btnGhostText: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '600' },
    aboutBox: {
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    aboutTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', marginBottom: 4 },
    aboutDesc: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 18 },
  });
}
