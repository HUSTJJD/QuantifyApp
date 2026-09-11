/**
 * 新建自选分组弹层：手动 / 扫描 / 策略 / 条件（动态）。
 */
import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { spacing, fontSize, radius, fontWeight } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import {
  createGroup,
  type WatchlistGroupKind,
  type WatchlistDynamicRule,
} from '@/data/repositories/WatchlistRepository';
import { getProfiles } from '@/quant/profileStore';
import type { StrategyProfile } from '@/quant/profile';

const KINDS: { kind: WatchlistGroupKind; label: string; desc: string }[] = [
  { kind: 'static', label: '手动', desc: '自己加减股票' },
  { kind: 'scan', label: '扫描候选', desc: '自动关联最近一次全市场扫描命中' },
  { kind: 'strategy', label: '策略信号', desc: '自动关联某策略的买入/卖出信号' },
  { kind: 'condition', label: '条件筛选', desc: '按现价/涨跌幅从自选中动态筛出' },
];

export function CreateGroupSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  /** 创建成功后回调；带新建分组 id 便于 UI 自动选中 */
  onCreated: (groupId?: string) => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<WatchlistGroupKind>('scan');
  const [profiles, setProfiles] = useState<StrategyProfile[]>([]);
  const [strategyId, setStrategyId] = useState('');
  const [side, setSide] = useState<'buy' | 'sell' | 'any'>('buy');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [pctMin, setPctMin] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    getProfiles()
      .then((ps) => {
        setProfiles(ps);
        if (ps[0]) setStrategyId(ps[0].id);
      })
      .catch(() => undefined);
  }, [visible]);

  const submit = async () => {
    const title = name.trim() || KINDS.find((k) => k.kind === kind)?.label || '新分组';
    setBusy(true);
    try {
      let rule: WatchlistDynamicRule | null = null;
      if (kind === 'scan') {
        rule = {};
      } else if (kind === 'strategy') {
        if (!strategyId) return;
        rule = { strategyId, side };
      } else if (kind === 'condition') {
        rule = {
          universe: 'watchlist',
          priceMin: Number(priceMin) || 0,
          priceMax: Number(priceMax) || 0,
          changePctMin: Number(pctMin) || 0,
          changePctMax: 0,
          strategyId: strategyId || undefined,
          side: 'any',
        };
      }
      const next = await createGroup(title, undefined, kind, rule);
      const created = next.find((g) => g.name === title && (g.kind ?? 'static') === kind);
      setName('');
      onCreated(created?.id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.mask}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>新建分组</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>关闭</Text>
            </TouchableOpacity>
          </View>
          <ScrollView>
            <Text style={styles.label}>名称</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="如：今日扫描 / MA金叉 / 低价股"
              placeholderTextColor={colors.textSecondary}
            />
            <Text style={styles.label}>类型</Text>
            {KINDS.map((k) => (
              <TouchableOpacity
                key={k.kind}
                style={[styles.kindRow, kind === k.kind && styles.kindActive]}
                onPress={() => setKind(k.kind)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.kindTitle}>{k.label}</Text>
                  <Text style={styles.kindDesc}>{k.desc}</Text>
                </View>
                <Text style={[styles.radio, kind === k.kind && { color: colors.primary }]}>
                  {kind === k.kind ? '●' : '○'}
                </Text>
              </TouchableOpacity>
            ))}

            {kind === 'strategy' && (
              <>
                <Text style={styles.label}>策略</Text>
                {profiles.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.kindRow, strategyId === p.id && styles.kindActive]}
                    onPress={() => setStrategyId(p.id)}
                  >
                    <Text style={styles.kindTitle}>{p.name}</Text>
                    <Text style={[styles.radio, strategyId === p.id && { color: colors.primary }]}>
                      {strategyId === p.id ? '●' : '○'}
                    </Text>
                  </TouchableOpacity>
                ))}
                <Text style={styles.label}>信号侧</Text>
                <View style={styles.chipRow}>
                  {(['buy', 'sell', 'any'] as const).map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.chip, side === s && styles.chipActive]}
                      onPress={() => setSide(s)}
                    >
                      <Text style={[styles.chipText, side === s && styles.chipTextActive]}>
                        {s === 'buy' ? '买入' : s === 'sell' ? '卖出' : '全部'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {kind === 'condition' && (
              <>
                <Text style={styles.label}>现价区间（元，0=不限）</Text>
                <View style={styles.row}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={priceMin}
                    onChangeText={setPriceMin}
                    placeholder="最低"
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.textSecondary}
                  />
                  <TextInput
                    style={[styles.input, { flex: 1, marginLeft: spacing.sm }]}
                    value={priceMax}
                    onChangeText={setPriceMax}
                    placeholder="最高"
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
                <Text style={styles.label}>涨跌幅 ≥ %</Text>
                <TextInput
                  style={styles.input}
                  value={pctMin}
                  onChangeText={setPctMin}
                  placeholder="如 3 表示涨幅≥3%"
                  keyboardType="decimal-pad"
                  placeholderTextColor={colors.textSecondary}
                />
              </>
            )}

            <TouchableOpacity
              style={[styles.btn, busy && { opacity: 0.5 }]}
              onPress={() => submit().catch(() => undefined)}
              disabled={busy}
            >
              <Text style={styles.btnText}>{busy ? '创建中…' : '创建'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: {
      maxHeight: '85%',
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.md,
    },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    title: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold as any },
    close: { color: colors.primary, fontSize: fontSize.sm },
    label: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: spacing.md, marginBottom: spacing.xs },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: 8,
      color: colors.text,
      fontSize: fontSize.sm,
    },
    row: { flexDirection: 'row' },
    kindRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      marginBottom: spacing.xs,
      backgroundColor: colors.surface,
    },
    kindActive: { borderColor: colors.primary },
    kindTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
    kindDesc: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    radio: { color: colors.textSecondary, fontSize: fontSize.lg, marginLeft: spacing.sm },
    chipRow: { flexDirection: 'row', gap: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.text, fontSize: fontSize.xs },
    chipTextActive: { color: '#fff', fontWeight: '700' },
    btn: {
      marginTop: spacing.lg,
      marginBottom: spacing.xl,
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      alignItems: 'center',
    },
    btnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '600' },
  });
}
