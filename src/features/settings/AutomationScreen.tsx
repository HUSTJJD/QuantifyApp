/**
 * 自动化任务设置页（Opptrix scheduled-jobs）。
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, fontWeight, layout } from '@/theme';
import { Card } from '@/components/ui/Card';
import { Toggle } from '@/components/ui/Toggle';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';
import {
  listJobs,
  listRunsForJob,
  runJobNow,
  setJobEnabled,
  ensureDefaultJobs,
  type ScheduledJob,
  type JobRun,
} from '@/quant/scheduler';

export function AutomationScreen({ onBack }: { onBack?: () => void }): React.JSX.Element {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [runsByJob, setRunsByJob] = useState<Record<string, JobRun[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const styles = makeStyles(colors);

  const reload = useCallback(async () => {
    await ensureDefaultJobs();
    const js = await listJobs();
    setJobs(js);
    const map: Record<string, JobRun[]> = {};
    for (const j of js) {
      map[j.id] = await listRunsForJob(j.id, 5);
    }
    setRunsByJob(map);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const onToggle = async (job: ScheduledJob, enabled: boolean) => {
    await setJobEnabled(job.id, enabled);
    await reload();
  };

  const onRun = async (job: ScheduledJob) => {
    setBusy(job.id);
    try {
      await runJobNow(job.id, 'manual');
      await reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView
      style={[styles.root, { paddingTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={reload} colors={[colors.primary]} tintColor={colors.primary} />
      }
    >
      <View style={styles.header}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} hitSlop={8}>
            <Text style={styles.back}>‹ 返回</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={styles.title}>自动化</Text>
      </View>
      <Text style={styles.hint}>本地计划任务：盘后摘要、尾盘扫描等。可在前台自动补跑。</Text>

      {jobs.map((job) => (
        <Card key={job.id} style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.jobTitle}>{job.title}</Text>
              <Text style={styles.jobMeta}>
                {job.scheduleKind === 'cron'
                  ? `cron ${job.schedule.expression}`
                  : job.scheduleKind === 'interval'
                    ? `每 ${job.schedule.every_sec}s`
                    : `一次 ${job.schedule.run_at ?? ''}`}
                {job.nextRunAt ? ` · 下次 ${new Date(job.nextRunAt).toLocaleString('zh-CN')}` : ''}
              </Text>
              <Text style={styles.jobStatus}>
                上次：{job.lastStatus ?? '—'}
                {job.lastRunAt ? ` · ${new Date(job.lastRunAt).toLocaleTimeString('zh-CN')}` : ''}
              </Text>
            </View>
            <Toggle on={job.enabled} onChange={() => onToggle(job, !job.enabled)} />
          </View>
          <View style={styles.actions}>
            <TouchableOpacity onPress={() => onRun(job)} disabled={busy === job.id} activeOpacity={0.75}>
              <Text style={styles.runText}>{busy === job.id ? '运行中…' : '立即运行'}</Text>
            </TouchableOpacity>
          </View>
          {(runsByJob[job.id] ?? []).slice(0, 3).map((r) => (
            <View key={r.id} style={styles.runRow}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: r.status === 'ok' ? colors.up : r.status === 'error' ? colors.down : colors.info },
                ]}
              />
              <Text style={styles.runText2} numberOfLines={1}>
                {r.summary || r.error || r.status}
              </Text>
            </View>
          ))}
        </Card>
      ))}
    </ScrollView>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.md },
    header: { marginBottom: spacing.sm },
    back: { color: colors.primary, fontSize: fontSize.md, marginBottom: spacing.xs },
    title: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold as any },
    hint: { color: colors.textSecondary, fontSize: fontSize.xs, marginBottom: spacing.md },
    card: { marginBottom: spacing.sm },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    jobTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
    jobMeta: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    jobStatus: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    actions: { marginTop: spacing.sm },
    runText: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '600' },
    runRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.xs,
      paddingTop: spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    dot: { width: 6, height: 6, borderRadius: 3 },
    runText2: { color: colors.textSecondary, fontSize: fontSize.xs, flex: 1 },
  });
}
