/**
 * 资产管理页。
 *
 * 使用成熟组件库 react-native-paper（Card / List / FAB / Dialog / TextInput 等）
 * 与图表库 victory-native（资产走势）构建，不自己写基础组件。
 * 数据来自 PortfolioRepository（客户端本地存储）。
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ScrollView,
  View,
  StyleSheet,
  Alert,
  Platform,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Appbar,
  Card,
  List,
  FAB,
  Dialog,
  Portal,
  Button,
  TextInput,
  Text,
  Divider,
} from 'react-native-paper';
import { Sparkline } from '@/components';
import { useQuotes } from '@/hooks/useMarketData';
import { displaySymbol } from '@/domain';
import { colors, spacing } from '@/theme';
import {
  getHoldings,
  getSnapshots,
  upsertHolding,
  removeHolding,
  addSnapshot,
  type Holding,
} from '@/repositories/PortfolioRepository';

export function AssetScreen({ onBack }: { onBack?: () => void }): React.JSX.Element {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [snapshots, setSnapshots] = useState<{ ts: number; total: number }[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', exchange: 'SH', shares: '', cost: '' });

  const symbols = holdings.map((h) => h.symbol);
  const { data: quotes, reload: reloadQuotes } = useQuotes(symbols);
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const rootStyle = useMemo<React.ComponentProps<typeof View>['style']>(
    () => [
      styles.root,
      {
        paddingTop: Platform.OS === 'ios' ? insets.top : 0,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      },
    ],
    [insets.top, insets.left, insets.right],
  );

  const loadPortfolio = useCallback(() => {
    getHoldings().then(setHoldings);
    getSnapshots().then(setSnapshots);
  }, []);

  useEffect(() => {
    loadPortfolio();
  }, [loadPortfolio]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([reloadQuotes(), loadPortfolio()]);
    } finally {
      setRefreshing(false);
    }
  }, [reloadQuotes, loadPortfolio]);

  // 计算资产
  const quoteMap = new Map(quotes?.map((q) => [q.symbol.code + q.symbol.exchange, q.last]) ?? []);
  let totalCost = 0;
  let totalValue = 0;
  const rows = holdings.map((h) => {
    const price = quoteMap.get(h.symbol.code + h.symbol.exchange) ?? h.costPrice;
    const value = price * h.shares;
    const cost = h.costPrice * h.shares;
    totalValue += value;
    totalCost += cost;
    const pnl = value - cost;
    const pnlPct = cost ? (pnl / cost) * 100 : 0;
    return { h, price, value, pnl, pnlPct };
  });
  const totalPnl = totalValue - totalCost;

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

  const chartData = snapshots.map((s) => ({ value: s.total }));

  return (
    <View
      style={rootStyle}
    >
      <Appbar.Header style={{ backgroundColor: colors.background }}>
        {onBack && <Appbar.BackAction color={colors.primary} onPress={onBack} />}
        <Appbar.Content title="资产管理" titleStyle={{ color: colors.text }} />
        <Appbar.Action icon="refresh" color={colors.primary} onPress={refreshSnapshot} />
      </Appbar.Header>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
        }
      >
        {/* 总资产卡片 */}
        <Card style={styles.card}>
          <Card.Content>
            <Text style={styles.label}>总资产（元）</Text>
            <Text style={styles.bigNumber}>{totalValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</Text>
            <Text style={[styles.pnl, { color: totalPnl >= 0 ? colors.up : colors.down }]}>
              {totalPnl >= 0 ? '+' : ''}
              {totalPnl.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 累计盈亏
            </Text>
          </Card.Content>
        </Card>

        {/* 资产走势 */}
        <Card style={styles.card}>
          <Card.Title title="资产走势" titleStyle={{ color: colors.text }} />
          <Card.Content>
            {chartData.length > 1 ? (
              <Sparkline data={chartData.map((d) => d.value)} height={180} color={colors.primary} />
            ) : (
              <Text style={styles.hint}>点击右上角刷新记录资产快照后生成走势</Text>
            )}
          </Card.Content>
        </Card>

        {/* 持仓列表 */}
        <Card style={styles.card}>
          <Card.Title title={`持仓（${rows.length}）`} titleStyle={{ color: colors.text }} />
          <Card.Content>
            {rows.length === 0 && <Text style={styles.hint}>暂无持仓，点击右下角 + 添加</Text>}
            {rows.map(({ h, price, value, pnl, pnlPct }) => (
              <View key={h.symbol.code + h.symbol.exchange}>
                <List.Item
                  title={displaySymbol(h.symbol, h.symbol.name)}
                  titleStyle={{ color: colors.text }}
                  description={`现价 ${price.toFixed(2)} · 市值 ${value.toFixed(0)}`}
                  descriptionStyle={{ color: colors.textSecondary }}
                  right={() => <RowRight pnl={pnl} pnlPct={pnlPct} />}
                  onLongPress={() => onDelete(h)}
                />
                <Divider />
              </View>
            ))}
          </Card.Content>
        </Card>
      </ScrollView>

      <FAB icon="plus" style={styles.fab} color="#fff" onPress={() => setDialogOpen(true)} />

      <Portal>
        <Dialog visible={dialogOpen} onDismiss={() => setDialogOpen(false)}>
          <Dialog.Title>添加持仓</Dialog.Title>
          <Dialog.Content>
            <TextInput
              label="代码"
              value={form.code}
              onChangeText={(t) => setForm({ ...form, code: t })}
              style={styles.input}
            />
            <TextInput
              label="名称（可选）"
              value={form.name}
              onChangeText={(t) => setForm({ ...form, name: t })}
              style={styles.input}
            />
            <TextInput
              label="市场 SH/SZ/HK/BJ"
              value={form.exchange}
              onChangeText={(t) => setForm({ ...form, exchange: t.toUpperCase() })}
              style={styles.input}
            />
            <TextInput
              label="持仓数量（股）"
              value={form.shares}
              onChangeText={(t) => setForm({ ...form, shares: t })}
              keyboardType="numeric"
              style={styles.input}
            />
            <TextInput
              label="成本价"
              value={form.cost}
              onChangeText={(t) => setForm({ ...form, cost: t })}
              keyboardType="numeric"
              style={styles.input}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialogOpen(false)}>取消</Button>
            <Button onPress={onAdd}>保存</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

/** 持仓行右侧盈亏展示（顶层组件，避免在父组件渲染期反复重建）。 */
function RowRight({ pnl, pnlPct }: { pnl: number; pnlPct: number }): React.JSX.Element {
  const color = pnl >= 0 ? colors.up : colors.down;
  return (
    <View style={styles.right}>
      <Text style={[styles.rightVal, { color }]}>
        {pnl >= 0 ? '+' : ''}
        {pnl.toFixed(0)}
      </Text>
      <Text style={[styles.rightPct, { color }]}>{pnlPct.toFixed(2)}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  card: { marginBottom: spacing.md, backgroundColor: colors.surface },
  label: { color: colors.textSecondary, fontSize: 13 },
  bigNumber: { color: colors.text, fontSize: 32, fontWeight: '800', marginVertical: 4 },
  pnl: { fontSize: 14, fontWeight: '600' },
  hint: { color: colors.textSecondary, fontSize: 13, paddingVertical: spacing.sm },
  right: { alignItems: 'flex-end', justifyContent: 'center' },
  rightVal: { fontSize: 14, fontWeight: '700' },
  rightPct: { fontSize: 12 },
  fab: { position: 'absolute', right: 16, bottom: 16, backgroundColor: colors.primary },
  input: { marginBottom: spacing.sm, backgroundColor: colors.surface },
});
