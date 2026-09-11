/**
 * 策略编辑器：多策略腿组合档案。
 * 分组：基础 → 选股 → 多策略组合（腿 + 合成方式） → 参数 → 止盈止损 → 交易规则。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STRATEGY_TEMPLATES } from '@/quant/core/templates';
import {
  SESSION_LABELS,
  PERIOD_LABELS,
  UNIVERSE_LABEL,
  COMBINE_LABEL,
  allParamGroupsOf,
  createProfile,
  legLabel,
  makeLegFromTemplate,
  type CombineMode,
  type SignalPeriod,
  type StrategyLeg,
  type TradeSession,
  type Universe,
  type StrategyProfile,
} from '@/quant/profile';
import { getProfiles, getProfile, upsertProfile } from '@/quant/profileStore';
import { spacing, fontSize, radius, fontWeight } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { Card, Section } from '@/components';

const RATIO_OPTIONS = [
  { label: '1/4', value: 0.25 },
  { label: '1/3', value: 1 / 3 },
  { label: '1/2', value: 0.5 },
  { label: '全仓', value: 1 },
];
const SESSION_OPTIONS: { label: string; value: TradeSession }[] = [
  { label: '全天', value: 'any' },
  { label: '早盘', value: 'early' },
  { label: '盘中', value: 'intraday' },
  { label: '尾盘', value: 'late' },
];
const PERIOD_OPTIONS: { label: string; value: SignalPeriod }[] = [
  { label: '日K', value: 'day' },
  { label: '60分', value: '60m' },
  { label: '30分', value: '30m' },
  { label: '15分', value: '15m' },
  { label: '5分', value: '5m' },
];

export function StrategyEditScreen({
  onBack,
  strategyId,
  templateId,
}: {
  onBack?: () => void;
  strategyId?: string;
  templateId?: string;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const isNew = !strategyId;
  const [draft, setDraft] = useState<StrategyProfile | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      if (strategyId) {
        const p = await getProfile(strategyId);
        if (p) {
          setDraft(p);
          setName(p.name);
        }
        return;
      }
      const preferred = templateId && STRATEGY_TEMPLATES.some((s) => s.id === templateId) ? templateId : STRATEGY_TEMPLATES[0]?.id;
      if (!preferred) return;
      const draft0 = createProfile([preferred]);
      try {
        const { getAppPrefs } = await import('@/settings/appPrefs');
        const prefs = await getAppPrefs();
        draft0.trade = {
          ...draft0.trade,
          positionRatio: prefs.defaultPositionRatio,
          period: prefs.defaultSignalPeriod,
        };
      } catch {
        // ignore
      }
      setDraft(draft0);
      setName(draft0.name);
    })().catch(() => undefined);
  }, [strategyId, templateId]);

  const patch = useCallback((fn: (d: StrategyProfile) => StrategyProfile) => {
    setDraft((d) => (d ? fn(d) : d));
  }, []);

  const legs = draft?.legs ?? [];

  const toggleLeg = useCallback((tid: string) => {
    setDraft((d) => {
      if (!d) return d;
      const i = d.legs.findIndex((l) => l.templateId === tid);
      let next: StrategyLeg[];
      if (i >= 0) {
        next = d.legs.filter((l) => l.templateId !== tid);
        if (next.length === 0) next = [makeLegFromTemplate(tid)];
      } else {
        next = [...d.legs, makeLegFromTemplate(tid)];
      }
      return { ...d, legs: next };
    });
  }, []);

  const setCombine = useCallback((mode: CombineMode) => {
    patch((d) => ({ ...d, combineMode: mode }));
  }, [patch]);

  const setLegWeight = useCallback((tid: string, w: number) => {
    patch((d) => ({
      ...d,
      legs: d.legs.map((l) => (l.templateId === tid ? { ...l, weight: w } : l)),
    }));
  }, [patch]);

  const save = useCallback(async () => {
    if (!draft || !name.trim() || draft.legs.length === 0) return;
    setSaving(true);
    try {
      await upsertProfile({ ...draft, name: name.trim(), note: draft.note, updatedAt: Date.now() });
      onBack?.();
    } finally {
      setSaving(false);
    }
  }, [draft, name, onBack]);

  const styles = makeStyles(colors);
  const legNames = legs.map(legLabel).join(' + ') || '未选择';
  const paramGroups = draft ? allParamGroupsOf(draft) : [];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* 头部 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isNew ? '新增策略' : '编辑策略'}</Text>
        <TouchableOpacity onPress={save} disabled={saving || !draft} hitSlop={8}>
          <Text style={[styles.save, (saving || !draft) && { color: colors.textSecondary }]}>{saving ? '保存中…' : '保存'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!draft && <Text style={styles.hint}>加载中…</Text>}

        {/* 多策略组合 */}
        {draft && (
          <>
            <Section title="策略组合（可多选）" />
            <Card>
              <Text style={styles.legend}>
                点选加入多条策略腿，同一策略可与其它模板组合；不再绑定单一「信号内核」。
              </Text>
              <View style={styles.chipWrap}>
                {STRATEGY_TEMPLATES.map((s) => {
                  const active = legs.some((l) => l.templateId === s.id);
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => toggleLeg(s.id)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{s.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.blockLabel, { marginTop: spacing.md }]}>合成方式</Text>
              <View style={styles.chipWrap}>
                {(Object.keys(COMBINE_LABEL) as CombineMode[]).map((m) => (
                  <ChoiceChip
                    key={m}
                    label={COMBINE_LABEL[m]}
                    active={(draft.combineMode ?? 'and') === m}
                    onPress={() => setCombine(m)}
                    colors={colors}
                  />
                ))}
              </View>

              {(draft.combineMode ?? 'and') === 'vote' && (
                <>
                  <Text style={[styles.blockLabel, { marginTop: spacing.md }]}>各腿权重</Text>
                  {legs.map((leg) => (
                    <Row key={leg.templateId} label={legLabel(leg)}>
                      <Stepper
                        value={leg.weight ?? 1}
                        step={1}
                        min={1}
                        max={5}
                        onChange={(v) => setLegWeight(leg.templateId, v)}
                        colors={colors}
                      />
                    </Row>
                  ))}
                </>
              )}
            </Card>
          </>
        )}

        {/* 基础 */}
        <Section title="基础设置" />
        <Card padded={false}>
          <Row label="策略名称">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="策略名称"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
            />
          </Row>
          <Row label="组合腿" last>
            <Text style={styles.staticText} numberOfLines={2}>
              {legNames}
              {draft?.combineMode ? ` · ${COMBINE_LABEL[draft.combineMode]}` : ''}
            </Text>
          </Row>
        </Card>

        {/* 选股标准 */}
        <Section title="选股标准" />
        <Card padded={false}>
          {draft && (
            <Block
              label="股票池"
              hint={
                draft.selection.universe === 'scan'
                  ? '使用最近一次全市场扫描快照命中（超 24h 自动回落自选）'
                  : '在自选股列表中选股'
              }
            >
              <View style={styles.chipWrap}>
                {(Object.keys(UNIVERSE_LABEL) as Universe[]).map((u) => (
                  <ChoiceChip
                    key={u}
                    label={UNIVERSE_LABEL[u]}
                    active={draft.selection.universe === u}
                    onPress={() => patch((d) => ({ ...d, selection: { ...d.selection, universe: u } }))}
                    colors={colors}
                  />
                ))}
              </View>
            </Block>
          )}
          {draft && (
            <>
              <Row label="股价上限（元）" hint="0 = 不限">
                <NumInput
                  value={draft.selection.priceMax}
                  onChange={(v) => patch((d) => ({ ...d, selection: { ...d.selection, priceMax: v } }))}
                  colors={colors}
                />
              </Row>
              <Row label="最小成交额（万元）" hint="0 = 不限" last>
                <NumInput
                  value={draft.selection.minTurnoverWan}
                  onChange={(v) => patch((d) => ({ ...d, selection: { ...d.selection, minTurnoverWan: v } }))}
                  colors={colors}
                />
              </Row>
            </>
          )}
        </Card>

        {/* 买卖信号（按全部腿的因子分组） */}
        {draft && (
          <>
            <Section title="买入 / 卖出信号参数" />
            {paramGroups.length === 0 ? (
              <Card padded={false}>
                <View style={styles.infoRow}>
                  <Text style={styles.legend}>当前组合无需用户参数（因子使用内置默认值）。</Text>
                </View>
              </Card>
            ) : (
              paramGroups.map((group, gi, arr) => (
                <React.Fragment key={group.factorId}>
                  <View style={styles.factorHead}>
                    <Text style={styles.factorTitle}>{group.factorLabel}</Text>
                    <Text style={styles.factorHint}>{group.factorId}</Text>
                  </View>
                  <Card padded={false}>
                    {group.specs.map((spec, i) => (
                      <Row key={spec.key} label={spec.label} last={i === group.specs.length - 1}>
                        <Stepper
                          value={draft.legs[0]?.params[spec.key] ?? 0}
                          step={spec.step ?? 1}
                          min={spec.min ?? 0}
                          max={spec.max ?? 999}
                          onChange={(v) => {
                            patch((d) => ({
                              ...d,
                              legs: d.legs.map((leg) => ({
                                ...leg,
                                params: { ...leg.params, [spec.key]: v },
                              })),
                            }));
                          }}
                          colors={colors}
                        />
                      </Row>
                    ))}
                  </Card>
                  {gi === arr.length - 1 && (
                    <View style={styles.infoRow}>
                      <Text style={styles.legend}>
                        参数作用于组合中相关因子；仓位与离场风控由止盈止损与交易规则负责。
                      </Text>
                    </View>
                  )}
                </React.Fragment>
              ))
            )}
          </>
        )}

        {/* 止盈止损 */}
        {draft && (
          <>
            <Section title="止盈 / 止损" />
            <Card padded={false}>
              <ExitStepperRow
                label="固定止盈"
                value={draft.exit.takeProfitPct}
                hint="相对成本上涨达 X% 平仓；0 = 关闭"
                onChange={(v) => patch((d) => ({ ...d, exit: { ...d.exit, takeProfitPct: v } }))}
                colors={colors}
              />
              <ExitStepperRow
                label="固定止损"
                value={draft.exit.stopLossPct}
                hint="相对成本下跌达 X% 平仓；0 = 关闭"
                onChange={(v) => patch((d) => ({ ...d, exit: { ...d.exit, stopLossPct: v } }))}
                colors={colors}
              />
              <ExitStepperRow
                label="移动止损"
                value={draft.exit.trailingPct}
                hint=">0 开启：价格从开仓后最高点回撤 X% 即平仓"
                last
                onChange={(v) => patch((d) => ({ ...d, exit: { ...d.exit, trailingPct: v } }))}
                colors={colors}
              />
            </Card>
          </>
        )}

        {/* 交易规则 */}
        {draft && (
          <>
            <Section title="交易规则" />
            <Card padded={false}>
              <Block label="允许时段" last>
                <View style={styles.chipWrap}>
                  {SESSION_OPTIONS.map((o) => (
                    <ChoiceChip
                      key={o.value}
                      label={o.label}
                      active={draft.trade.session === o.value}
                      onPress={() => patch((d) => ({ ...d, trade: { ...d.trade, session: o.value } }))}
                      colors={colors}
                    />
                  ))}
                </View>
              </Block>
              <Block label="信号K线" last>
                <View style={styles.chipWrap}>
                  {PERIOD_OPTIONS.map((o) => (
                    <ChoiceChip
                      key={o.value}
                      label={o.label}
                      active={draft.trade.period === o.value}
                      onPress={() => patch((d) => ({ ...d, trade: { ...d.trade, period: o.value } }))}
                      colors={colors}
                    />
                  ))}
                </View>
              </Block>
              <Block label="单笔仓位" last>
                <View style={styles.chipWrap}>
                  {RATIO_OPTIONS.map((o) => (
                    <ChoiceChip
                      key={o.label}
                      label={o.label}
                      active={Math.abs(draft.trade.positionRatio - o.value) < 0.01}
                      onPress={() => patch((d) => ({ ...d, trade: { ...d.trade, positionRatio: o.value } }))}
                      colors={colors}
                    />
                  ))}
                </View>
              </Block>
              <Block label="最大持仓数" hint={`同时最多持有 ${draft.trade.maxPositions} 只`} last>
                <Stepper
                  value={draft.trade.maxPositions}
                  step={1}
                  min={1}
                  max={20}
                  onChange={(v) => patch((d) => ({ ...d, trade: { ...d.trade, maxPositions: v } }))}
                  colors={colors}
                />
              </Block>
            </Card>
          </>
        )}

        {/* 保存按钮 */}
        {draft && (
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: colors.primary }, (saving || !name.trim()) && { opacity: 0.6 }]}
            disabled={saving || !name.trim()}
            onPress={save}
            activeOpacity={0.9}
          >
            <Text style={styles.saveBtnText}>{isNew ? '创建策略' : '保存修改'}</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.footnote}>
          {SESSION_LABELS[draft?.trade.session ?? 'any']} · {PERIOD_LABELS[draft?.trade.period ?? 'day']}：保存后自动交易运行时下个 tick 生效；「快速回测」使用当前所有编辑项（含风控）在历史数据上验证。
        </Text>
      </ScrollView>
    </View>
  );
}

/* ------------------------------- 表单原子件 ------------------------------- */

function Row({
  label,
  hint,
  children,
  last,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  last?: boolean;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  return (
    <View style={[styles.row, { borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderColor: colors.border }]}>
      <View style={styles.rowLabelWrap}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Block({
  label,
  hint,
  last,
  children,
}: {
  label: string;
  hint?: string;
  last?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  return (
    <View style={[styles.block, { borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderColor: colors.border }]}>
      <Text style={styles.blockLabel}>{label}</Text>
      {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

function NumInput({
  value,
  onChange,
  colors,
}: {
  value: number;
  onChange: (v: number) => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
}): React.JSX.Element {
  const styles = makeStyles(colors);
  return (
    <TextInput
      value={value > 0 ? String(value) : ''}
      onChangeText={(t) => {
        const n = parseFloat(t);
        onChange(Number.isFinite(n) && n > 0 ? n : 0);
      }}
      placeholder="0"
      placeholderTextColor={colors.textSecondary}
      keyboardType="decimal-pad"
      style={[styles.numInput, { color: colors.text, borderColor: colors.border }]}
    />
  );
}

function Stepper({
  value,
  onChange,
  step,
  min,
  max,
  colors,
}: {
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  max: number;
  colors: ReturnType<typeof useAppTheme>['colors'];
}): React.JSX.Element {
  const styles = makeStyles(colors);
  const round = (n: number) => Math.round(n * 100) / 100;
  const dec = step % 1 !== 0 ? 1 : 0;
  return (
    <View style={styles.stepper}>
      <TouchableOpacity style={[styles.stepBtn, { borderColor: colors.border }]} onPress={() => onChange(round(Math.max(min, value - step)))} hitSlop={6}>
        <Text style={styles.stepBtnText}>−</Text>
      </TouchableOpacity>
      <Text style={styles.stepValue}>{value.toFixed(dec)}{step % 1 !== 0 ? '' : ''}</Text>
      <TouchableOpacity style={[styles.stepBtn, { borderColor: colors.border }]} onPress={() => onChange(round(Math.min(max, value + step)))} hitSlop={6}>
        <Text style={styles.stepBtnText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

function ExitStepperRow({
  label,
  value,
  hint,
  onChange,
  last,
  colors,
}: {
  label: string;
  value: number;
  hint: string;
  onChange: (v: number) => void;
  last?: boolean;
  colors: ReturnType<typeof useAppTheme>['colors'];
}): React.JSX.Element {
  return (
    <Row label={label} hint={hint} last={last}>
      <View style={{ alignItems: 'flex-end' }}>
        <Stepper value={value} onChange={onChange} step={1} min={0} max={200} colors={colors} />
        <Text style={makeStyles(colors).unitText}>{value > 0 ? `${value}% · 开启` : '关闭'}</Text>
      </View>
    </Row>
  );
}

function ChoiceChip({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
}): React.JSX.Element {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={[styles.choiceChip, active && { backgroundColor: colors.primary, borderColor: colors.primary }]} onPress={onPress} activeOpacity={0.8}>
      <Text style={[styles.choiceText, active && { color: '#fff', fontWeight: '700' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.md, paddingBottom: spacing.xxl },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
    back: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
    headerTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold as any },
    save: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
    hint: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center', paddingVertical: spacing.lg },
    legend: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 16 },
    warn: { color: colors.warning, fontSize: fontSize.xs, marginTop: spacing.sm },

    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    rowLabelWrap: { flex: 1, marginRight: spacing.md },
    rowLabel: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
    rowHint: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2, lineHeight: 14 },
    staticText: { color: colors.textSecondary, fontSize: fontSize.sm },
    input: { flex: 1, minWidth: 110, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 6, fontSize: fontSize.sm, textAlign: 'right' },
    numInput: { minWidth: 80, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 6, fontSize: fontSize.sm, textAlign: 'right' },

    block: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    blockLabel: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600', marginBottom: spacing.sm },

    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.text, fontSize: fontSize.xs },
    chipTextActive: { color: '#fff', fontWeight: '700' },
    choiceChip: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
    choiceText: { color: colors.text, fontSize: fontSize.xs },
    infoRow: { padding: spacing.md },
    factorHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginTop: spacing.md,
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.xs,
    },
    factorTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
    factorHint: { color: colors.textSecondary, fontSize: fontSize.xs },

    stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    stepBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
    stepBtnText: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', marginTop: -2 },
    stepValue: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold as any, minWidth: 44, textAlign: 'center' },
    unitText: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },

    saveBtn: { height: 48, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
    saveBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: fontWeight.heavy as any },
    footnote: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 16, marginTop: spacing.sm },
  });
}
