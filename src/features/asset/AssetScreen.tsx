/**
 * 资产管理页 —— 去 paper，对齐 ghostfolio：大号净值 + 净盈亏双行 + 持仓占比条 + 骨架。
 * 数据来自 PortfolioRepository（客户端本地存储）。
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  RefreshControl,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { LineGraphView, Card, Section, Value, Icon, Skeleton, EmptyState } from '@/components';
import { Icons } from '@/assets/icons';
import { useQuotes } from '@/hooks/useMarketData';
import { displaySymbol } from '@/domain';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, radius, fontWeight, layout } from '@/theme';
import {
  getHoldings,
  getSnapshots,
  upsertHolding,
  removeHolding,
  addSnapshot,
  type Holding,
} from '@/data/repositories/PortfolioRepository';
import {
  computePositionPnl,
  computePortfolioSummary,
  computeNavMetrics,
  computeAttribution,
} from '@/quant/portfolioPerf';

export function AssetScreen({ onBack }: { onBack?: () => void }): React.JSX.Element {
  const { colors } = useAppTheme();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [snapshots, setSnapshots] = useState<{ ts: number; total: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', exchange: 'SH', shares: '', cost: '' });

  const focused = useIsFocused();
  const symbols = holdings.map((h) => h.symbol);
  const { data: quotes, reload: reloadQuotes } = useQuotes(symbols, 'stock', focused);
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const styles = makeStyles(colors);

  const loadPortfolio = useCallback(() => {
    return Promise.all([getHoldings(), getSnapshots()]).then(([h, s]) => {
      setHoldings(h);
      setSnapshots(s);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    loadPortfolio().catch(() => setLoading(false));
  }, [loadPortfolio]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([reloadQuotes(), loadPortfolio()]);
    } finally {
      setRefreshing(false);
    }
  }, [reloadQuotes, loadPortfolio]);

  const quoteMap = new Map(quotes?.map((q) => [q.symbol.code + q.symbol.exchange, q.last]) ?? []);
  const positionPnls = holdings.map((h) => {
    const price = quoteMap.get(h.symbol.code + h.symbol.exchange) ?? h.costPrice;
    return { pos: h, price, pnl: computePositionPnl(h, price, 0) };
  });
  const totalValue = positionPnls.reduce((s, r) => s + r.pnl.value, 0);
  const rows = positionPnls.map((r) => ({
    h: r.pos,
    price: r.price,
    value: r.pnl.value,
    pnl: computePositionPnl(r.pos, r.price, totalValue),
  }));
  const summary = computePortfolioSummary(rows.map((r) => r.pnl));
  const attribution = computeAttribution(rows.map((r) => r.pnl));
  const navMetrics = snapshots.length >= 2 ? computeNavMetrics(snapshots.map((s) => s.total)) : null;

  useEffect(() => {
    if (!focused) return;
    if (!(totalValue > 0)) return;
    let cancelled = false;
    (async () => {
      try {
        const snaps = await getSnapshots();
        const dayKey = (ts: number) =>
          new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(ts);
        const today = dayKey(Date.now());
        const hasToday = snaps.some((s) => dayKey(s.ts) === today);
        if (hasToday || cancelled) return;
        await addSnapshot({ ts: Date.now(), total: totalValue });
        if (!cancelled) setSnapshots(await getSnapshots());
      } catch {
        // silent
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focused, totalValue]);

  const refreshSnapshot = async () => {
    await addSnapshot({ ts: Date.now(), total: totalValue });
    setSnapshots(await getSnapshots());
  };

  const onAdd = async () => {
    const shares = Number(form.shares);
    const cost = Number(form.cost);
    if (!form.code || !shares || !cost) {
      Alert.alert('请填写完整', '代码、数量、成本价为必填');
      return;
    }
    const h: Holding = {
      symbol: { code: form.code, exchange: form.exchange as any, name: form.name || form.code },
      shares,
      costPrice: cost,
    };
    setHoldings(await upsertHolding(h));
    setDialogOpen(false);
    setForm({ code: '', name: '', exchange: 'SH', shares: '', cost: '' });
  };

  const onDelete = (h: Holding) => {
    Alert.alert('删除持仓', `确认删除 ${h.symbol.name || h.symbol.code}？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => setHoldings(await removeHolding(h.symbol)),
      },
    ]);
  };

  const chartData = snapshots.map((s) => s.total);

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: Platform.OS === 'ios' ? insets.top : 0,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <View style={styles.headerBar}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={8}>
            <Icon name={Icons.chevronRight} size="lg" color="primary" style={{ transform: [{ rotate: '180deg' }] }} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}
        <Text style={styles.headerTitle}>资产管理</Text>
        <TouchableOpacity onPress={refreshSnapshot} style={styles.backBtn} hitSlop={8}>
          <Icon name={Icons.refresh} size="md" color="primary" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
        }
      >
        {/* 总资产大卡（ghostfolio） */}
        <Card style={styles.heroCard} elevated>
          {loading ? (
            <Skeleton shape="line" width={180} height={36} />
          ) : (
            <>
              <Value
                label="总资产（元）"
                value={summary.totalValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
                size="xl"
                color={colors.text}
              />
              <Text
                style={[
                  styles.pnl,
                  { color: summary.totalPnl >= 0 ? colors.up : colors.down },
                ]}
              >
                {summary.totalPnl >= 0 ? '+' : ''}
                {summary.totalPnl.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}（
                {summary.totalPnlPct >= 0 ? '+' : ''}
                {summary.totalPnlPct.toFixed(2)}%）累计盈亏
              </Text>
            </>
          )}
        </Card>

        {navMetrics && (
          <>
            <Section title="净值指标" />
            <Card>
              <View style={styles.metricsRow}>
                <Metric label="区间收益" value={`${navMetrics.totalReturnPct.toFixed(2)}%`} color={navMetrics.totalReturnPct >= 0 ? colors.up : colors.down} />
                <Metric label="年化收益" value={`${navMetrics.annualizedReturnPct.toFixed(2)}%`} color={navMetrics.annualizedReturnPct >= 0 ? colors.up : colors.down} />
                <Metric label="最大回撤" value={`${navMetrics.maxDrawdownPct.toFixed(2)}%`} color={colors.down} />
              </View>
              <View style={styles.metricsRow}>
                <Metric label="夏普比率" value={navMetrics.sharpe.toFixed(2)} />
                <Metric label="年化波动" value={`${navMetrics.volatilityPct.toFixed(2)}%`} />
                <Metric label="快照数" value={String(snapshots.length)} />
              </View>
            </Card>
          </>
        )}

        {attribution.length > 0 && (
          <>
            <Section title="盈亏归因" />
            <Card>
              {attribution.map((a) => (
                <View key={a.symbol.code + a.symbol.exchange} style={styles.attrRow}>
                  <Text style={styles.attrName} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <View style={styles.attrBar}>
                    <View
                      style={[
                        styles.attrBarFill,
                        {
                          width: `${Math.min(100, Math.abs(a.contributionPct) * 100)}%`,
                          backgroundColor: a.pnl >= 0 ? colors.up : colors.down,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.attrPnl, { color: a.pnl >= 0 ? colors.up : colors.down }]}>
                    {a.pnl >= 0 ? '+' : ''}
                    {a.pnl.toFixed(0)}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        )}

        <Section title="资产走势" />
        <Card>
          {chartData.length > 1 ? (
            <LineGraphView
              values={chartData}
              times={snapshots.map((s) => s.ts)}
              height={180}
              trendingUp={navMetrics ? navMetrics.totalReturnPct >= 0 : null}
              enablePanGesture
              enableGradient
            />
          ) : (
            <EmptyState
              text="暂无净值曲线"
              hint="点击右上角刷新，记录资产快照后生成走势"
              icon={Icons.chart}
            />
          )}
        </Card>

        <Section title={`持仓（${rows.length}）`} />
        <Card padded={false}>
          {rows.length === 0 ? (
            <EmptyState
              text="暂无持仓"
              hint="点击右下角 + 添加一只股票，开始跟踪资产"
              icon={Icons.wallet}
              actionLabel="添加持仓"
              onAction={() => setDialogOpen(true)}
            />
          ) : (
            rows.map(({ h, price, value, pnl }, i) => (
              <TouchableOpacity
                key={h.symbol.code + h.symbol.exchange}
                style={[styles.holdRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border }]}
                onLongPress={() => onDelete(h)}
                activeOpacity={0.75}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.holdName} numberOfLines={1}>
                    {displaySymbol(h.symbol, h.symbol.name)}
                  </Text>
                  <Text style={styles.holdDesc}>
                    现价 {price.toFixed(2)} · 市值 {value.toFixed(0)} · 占比 {(pnl.weight * 100).toFixed(1)}%
                  </Text>
                  <View style={styles.weightBar}>
                    <View
                      style={[
                        styles.weightFill,
                        {
                          width: `${Math.min(100, pnl.weight * 100)}%`,
                          backgroundColor: colors.primary,
                        },
                      ]}
                    />
                  </View>
                </View>
                <View style={styles.holdRight}>
                  <Text style={[styles.holdPnl, { color: pnl.pnl >= 0 ? colors.up : colors.down }]}>
                    {pnl.pnl >= 0 ? '+' : ''}
                    {pnl.pnl.toFixed(0)}
                  </Text>
                  <Text style={[styles.holdPct, { color: pnl.pnl >= 0 ? colors.up : colors.down }]}>
                    {pnl.pnlPct.toFixed(2)}%
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </Card>
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={() => setDialogOpen(true)} activeOpacity={0.85}>
        <Icon name={Icons.plus} size="lg" color="#fff" />
      </TouchableOpacity>

      <Modal visible={dialogOpen} transparent animationType="fade" onRequestClose={() => setDialogOpen(false)}>
        <View style={styles.modalMask}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={styles.modalTitle}>添加持仓</Text>
            {(
              [
                { key: 'code', label: '代码', keyboard: 'default' as const },
                { key: 'name', label: '名称（可选）', keyboard: 'default' as const },
                { key: 'exchange', label: '市场 SH/SZ/HK/BJ', keyboard: 'default' as const },
                { key: 'shares', label: '持仓数量（股）', keyboard: 'numeric' as const },
                { key: 'cost', label: '成本价', keyboard: 'numeric' as const },
              ] as const
            ).map((f) => (
              <TextInput
                key={f.key}
                placeholder={f.label}
                placeholderTextColor={colors.textSecondary}
                value={form[f.key]}
                onChangeText={(t) =>
                  setForm({
                    ...form,
                    [f.key]: f.key === 'exchange' ? t.toUpperCase() : t,
                  })
                }
                keyboardType={f.keyboard}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
              />
            ))}
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setDialogOpen(false)} style={styles.modalBtnGhost}>
                <Text style={{ color: colors.textSecondary }}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onAdd} style={styles.modalBtnPrimary}>
                <Text style={styles.modalBtnPrimaryText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ color: color ?? colors.text, fontSize: 16, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.sm,
      height: 48,
    },
    backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold as any },
    content: { padding: spacing.md },
    heroCard: { marginBottom: spacing.sm },
    pnl: { fontSize: fontSize.md, fontWeight: '600', marginTop: spacing.xs },
    metricsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: spacing.sm },
    attrRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
    attrName: { color: colors.text, fontSize: fontSize.xs, width: 70 },
    attrBar: {
      flex: 1,
      height: 8,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 4,
      marginHorizontal: 8,
      overflow: 'hidden',
    },
    attrBarFill: { height: '100%', borderRadius: 4 },
    attrPnl: { fontSize: fontSize.xs, fontWeight: '600', width: 60, textAlign: 'right' },
    holdRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      gap: spacing.sm,
    },
    holdName: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
    holdDesc: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    weightBar: {
      height: 4,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 2,
      marginTop: 6,
      overflow: 'hidden',
    },
    weightFill: { height: '100%', borderRadius: 2 },
    holdRight: { alignItems: 'flex-end' },
    holdPnl: { fontSize: fontSize.md, fontWeight: '700' },
    holdPct: { fontSize: fontSize.xs },
    fab: {
      position: 'absolute',
      right: 16,
      bottom: 16,
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 4,
    },
    modalMask: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    modalCard: {
      borderRadius: layout.radiusPanel,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    modalTitle: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold as any,
      marginBottom: spacing.sm,
    },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: layout.radiusControl,
      paddingHorizontal: spacing.md,
      height: 42,
      fontSize: fontSize.md,
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.md,
      marginTop: spacing.sm,
    },
    modalBtnGhost: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    modalBtnPrimary: {
      backgroundColor: colors.primary,
      borderRadius: layout.radiusControl,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    modalBtnPrimaryText: { color: '#fff', fontWeight: '600' },
  });
}
