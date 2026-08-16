/**
 * 设置页：数据源自由切换 + 同花顺 API Key 自填。
 *
 * 核心需求落地：
 *  - 后端由用户自由选择：列出所有已注册数据源（同花顺 / stock-api / 未来任意后端），
 *    点击即切换主数据源并持久化；
 *  - 同花顺 Key 用户自己设置，存到本地存储（加密/落盘策略由 storage 层负责），不写死；
 *  - 无后端，所有偏好都保存在客户端。
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
import { marketData } from '@/api';
import { getApiConfig } from '@/api';
import { colors, spacing, fontSize, radius } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';

export function SettingsScreen({ onBack, onOpenDebug, onOpenApiStats }: { onBack: () => void; onOpenDebug?: () => void; onOpenApiStats?: () => void }): React.JSX.Element {
  const { mode, toggle } = useAppTheme();
  const [sources, setSources] = useState<{ id: string; label: string }[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();

  const loadSettings = useCallback(() => {
    setSources(marketData.listSources());
    setSelected(getApiConfig().primary);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      loadSettings();
    } finally {
      setRefreshing(false);
    }
  }, [loadSettings]);

  const onSelectSource = async (id: string) => {
    setSelected(id);
    await marketData.setPreferredSource(id);
  };

  const onSaveKey = async () => {
    setSaving(true);
    try {
      await marketData.setApiKey(apiKey.trim());
      Alert.alert('已保存', '同花顺 API Key 已保存到本机');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom }]}
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
        <Text style={styles.sourceLabel}>主题</Text>
        <TouchableOpacity style={styles.themeToggle} onPress={toggle}>
          <Text style={styles.themeToggleText}>{mode === 'dark' ? '暗色' : '亮色'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>数据源（可自由切换后端）</Text>
      <Text style={styles.sectionHint}>
        数据优先级：同花顺 › stock-api 兜底。你可选择任意已注册后端作为主源。
      </Text>
      {sources.map((s) => (
        <TouchableOpacity
          key={s.id}
          style={[styles.sourceRow, selected === s.id && styles.sourceRowActive]}
          onPress={() => onSelectSource(s.id)}
        >
          <Text style={styles.sourceLabel}>{s.label}</Text>
          <Text style={[styles.radio, selected === s.id && styles.radioOn]}>
            {selected === s.id ? '●' : '○'}
          </Text>
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

      {onOpenDebug && (
        <>
          <Text style={styles.sectionTitle}>调试</Text>
          <TouchableOpacity style={styles.sourceRow} onPress={onOpenApiStats}>
            <Text style={styles.sourceLabel}>API 稳定性统计</Text>
            <Text style={styles.radio}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sourceRow} onPress={onOpenDebug}>
            <Text style={styles.sourceLabel}>调试日志</Text>
            <Text style={styles.radio}>›</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  back: { color: colors.primary, fontSize: fontSize.md, marginRight: spacing.md },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  sectionTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.xs },
  sectionHint: { color: colors.textSecondary, fontSize: fontSize.xs, marginBottom: spacing.sm },
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
  },
  themeToggle: { backgroundColor: colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.sm },
  themeToggleText: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
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
  },
  sourceRowActive: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  sourceLabel: { color: colors.text, fontSize: fontSize.md },
  radio: { color: colors.textSecondary, fontSize: fontSize.lg },
  radioOn: { color: colors.primary },
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
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '600' },
});
