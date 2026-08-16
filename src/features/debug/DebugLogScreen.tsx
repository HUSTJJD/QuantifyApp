/**
 * DebugLogScreen —— App 内日志查看面板。
 *
 * 真机/模拟器无法随时开 debugger 时，可用它直接查看 logger 的内存环形缓冲，
 * 快速定位「某数据源拉不到数据」「请求超时」「fetch 缺失」等问题。
 * 支持：刷新、按级别过滤、清空、复制导出文本。
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Switch,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { logger, type LogLevel } from '@/utils/logger';
import { colors, spacing, fontSize, radius } from '@/theme';

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: colors.textSecondary,
  info: colors.primary,
  warn: '#E0A800',
  error: colors.down,
};

export function DebugLogScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [entries, setEntries] = useState(logger.getBuffer());
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => setEntries(logger.getBuffer()), []);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);
  const clear = useCallback(() => {
    logger.clear();
    setEntries([]);
  }, []);

  const shown = entries.filter((e) => (onlyErrors ? LEVELS.indexOf(e.level) >= LEVELS.indexOf('warn') : true));
  const text = logger.exportText();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.title}>调试日志</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.toolbar}>
        <TouchableOpacity style={styles.btn} onPress={refresh}>
          <Text style={styles.btnText}>刷新</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={clear}>
          <Text style={styles.btnText}>清空</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => { /* 复制由系统分享承担，这里仅占位 */ }}>
          <Text style={styles.btnText}>导出</Text>
        </TouchableOpacity>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>仅告警/错误</Text>
          <Switch value={onlyErrors} onValueChange={setOnlyErrors} />
        </View>
      </View>

      <ScrollView
        style={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
        }
      >
        {shown.length === 0 && <Text style={styles.empty}>暂无日志</Text>}
        {shown.map((e, i) => (
          <View key={i} style={styles.row}>
            <Text style={[styles.level, { color: LEVEL_COLOR[e.level] }]}>
              {e.level.toUpperCase()}
            </Text>
            <Text style={styles.tag}>[{e.tag}]</Text>
            <Text style={styles.msg}>
              {e.message}
              {e.extra !== undefined ? `\n${typeof e.extra === 'string' ? e.extra : JSON.stringify(e.extra)}` : ''}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* 导出文本对调试极有用，但复制到剪贴板需 Clipboard，这里保留明文以便手动长按选择 */}
      <View style={styles.exportBox}>
        <Text style={styles.exportTitle}>导出文本（可长按复制）</Text>
        <ScrollView style={styles.exportScroll}>
          <Text selectable style={styles.exportText}>
            {text || '(空)'}
          </Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { color: colors.primary, fontSize: fontSize.md },
  headerSpacer: { width: 60 },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '600' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  btn: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnText: { color: colors.text, fontSize: fontSize.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto', gap: spacing.xs },
  switchLabel: { color: colors.textSecondary, fontSize: fontSize.sm },
  list: { flex: 1, paddingHorizontal: spacing.md },
  row: {
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  level: { fontSize: fontSize.xs, fontWeight: '700' },
  tag: { fontSize: fontSize.xs, color: colors.textSecondary },
  msg: { fontSize: fontSize.sm, color: colors.text, marginTop: 2 },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xl },
  exportBox: {
    maxHeight: 160,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  exportTitle: { color: colors.textSecondary, fontSize: fontSize.xs, marginBottom: spacing.xs },
  exportScroll: { maxHeight: 120 },
  exportText: { fontSize: fontSize.xs, color: colors.text, fontFamily: 'Courier' },
});
