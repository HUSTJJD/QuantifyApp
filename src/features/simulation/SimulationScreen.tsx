/**
 * 模拟盘主页：账户总览（总资产/盈亏/当日盈亏）、持仓、委托、成交记录。
 * 富途风格暗色卡片布局，接入实时行情计算浮动盈亏。
 */
import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, radius } from '@/theme';
import { useQuotes } from '@/hooks/useMarketData';
import { useSimAccount, symbolKey } from '@/hooks/useSimAccount';
import { calcFee, DEFAULT_INIT_CASH, round2 } from '@/simulation';
import { toFullCode } from '@/domain';
import type { Trade, Order, SimPosition } from '@/simulation';

const SIDE_TEXT: Record<string, string> = { buy: '买入', sell: '卖出' };
const STATUS_TEXT: Record<string, string> = {
  filled: '已成交',
  partial: '部分成交',
  canceled: '已撤单',
  rejected: '已拒绝',
  pending: '待成交',
};

type Tab = 'positions' | 'orders' | 'trades';

export function SimulationScreen(): React.JSX.Element {
  const { colors } = useAppTheme();
  const { summary, positions, orders, trades, reset } = useSimAccount();
  // 持仓需要实时行情算盈亏
  const watchSymbols = positions.map((p) => p.symbol);
  const { data: quotes } = useQuotes(watchSymbols, 'stock');

  const [tab, setTab] = React.useState<Tab>('positions');

  const onReset = () => {
    Alert.alert('重置模拟盘', `将清空所有持仓与资金，恢复初始 ${DEFAULT_INIT_CASH.toLocaleString()} 元？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '重置',
        style: 'destructive',
        onPress: () => reset(DEFAULT_INIT_CASH),
      },
    ]);
  };

  const quoteMap = new Map<string, number>();
  (quotes ?? []).forEach((q) => quoteMap.set(symbolKey(q.symbol), q.last));

  return (
    <ScrollView style={[styles.root, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      {/* 资产总览 */}
      <View style={[styles.summaryCard, { backgroundColor: colors.surface }]}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>模拟总资产（元）</Text>
        <Text style={[styles.total, { color: colors.text }]}>
          {summary ? summary.totalAsset.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '--'}
        </Text>
        <View style={styles.row2}>
          <Metric label="持仓市值" value={summary ? summary.marketValue.toFixed(2) : '--'} color={colors.text} />
          <Metric
            label="累计盈亏"
            value={summary ? `${summary.totalPnl >= 0 ? '+' : ''}${summary.totalPnl.toFixed(2)}` : '--'}
            color={summary ? (summary.totalPnl >= 0 ? colors.up : colors.down) : colors.text}
          />
          <Metric
            label="累计收益率"
            value={summary ? `${summary.totalPnlPct >= 0 ? '+' : ''}${summary.totalPnlPct.toFixed(2)}%` : '--'}
            color={summary ? (summary.totalPnlPct >= 0 ? colors.up : colors.down) : colors.text}
          />
        </View>
        <View style={styles.row2}>
          <Metric label="可用现金" value={summary ? summary.cash.toFixed(2) : '--'} color={colors.text} />
          <Metric
            label="当日盈亏"
            value={summary ? `${summary.dayPnl >= 0 ? '+' : ''}${summary.dayPnl.toFixed(2)}` : '--'}
            color={summary ? (summary.dayPnl >= 0 ? colors.up : colors.down) : colors.text}
          />
          <Metric
            label="当日收益率"
            value={summary ? `${summary.dayPnlPct >= 0 ? '+' : ''}${summary.dayPnlPct.toFixed(2)}%` : '--'}
            color={summary ? (summary.dayPnlPct >= 0 ? colors.up : colors.down) : colors.text}
          />
        </View>
      </View>

      {/* Tab 切换 */}
      <View style={[styles.tabs, { borderColor: colors.border }]}>
        {(['positions', 'orders', 'trades'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t ? styles.tabActive : null, tab === t ? { borderBottomColor: colors.primary } : null]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, { color: tab === t ? colors.primary : colors.textSecondary }]}>
              {t === 'positions' ? '持仓' : t === 'orders' ? '委托' : '成交'}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={styles.tabSpacer} />
        <TouchableOpacity onPress={onReset}>
          <Text style={[styles.resetText, { color: colors.textSecondary }]}>重置</Text>
        </TouchableOpacity>
      </View>

      {/* 列表 */}
      {tab === 'positions' && <PositionsTab positions={positions} quoteMap={quoteMap} colors={colors} />}
      {tab === 'orders' && <OrdersTab orders={orders} colors={colors} />}
      {tab === 'trades' && <TradesTab trades={trades} colors={colors} />}
    </ScrollView>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }): React.JSX.Element {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricLabel, { color: color }]}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
    </View>
  );
}

function PositionsTab({
  positions,
  quoteMap,
  colors,
}: {
  positions: SimPosition[];
  quoteMap: Map<string, number>;
  colors: ReturnType<typeof useAppTheme>['colors'];
}): React.JSX.Element {
  if (positions.length === 0) {
    return <Empty text="暂无持仓，去个股页下单吧" colors={colors} />;
  }
  return (
    <>
      {positions.map((p) => {
        const price = quoteMap.get(symbolKey(p.symbol));
        const marketValue = price ? round2(price * p.shares) : 0;
        const cost = round2(p.costPrice * p.shares);
        const pnl = round2(marketValue - cost);
        const pct = cost > 0 ? round2((pnl / cost) * 100) : 0;
        const up = pnl >= 0;
        return (
          <View key={toFullCode(p.symbol)} style={[styles.item, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.itemTop}>
              <Text style={[styles.code, { color: colors.text }]}>
                {p.symbol.name ?? toFullCode(p.symbol)}
              </Text>
              <Text style={[styles.pnl, { color: up ? colors.up : colors.down }]}>
                {up ? '+' : ''}
                {pnl.toFixed(2)} ({up ? '+' : ''}
                {pct.toFixed(2)}%)
              </Text>
            </View>
            <View style={styles.itemMid}>
              <Cell label="持仓" value={`${p.shares}`} color={colors.textSecondary} />
              <Cell label="可用" value={`${p.available}`} color={colors.textSecondary} />
              <Cell label="成本" value={p.costPrice.toFixed(2)} color={colors.textSecondary} />
              <Cell label="现价" value={price != null ? price.toFixed(2) : '--'} color={colors.textSecondary} />
              <Cell label="市值" value={marketValue.toFixed(2)} color={colors.textSecondary} />
            </View>
          </View>
        );
      })}
    </>
  );
}

function OrdersTab({ orders, colors }: { orders: Order[]; colors: ReturnType<typeof useAppTheme>['colors'] }): React.JSX.Element {
  if (orders.length === 0) return <Empty text="暂无委托" colors={colors} />;
  return (
    <>
      {orders.map((o) => (
        <View key={o.id} style={[styles.item, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.itemTop}>
            <Text style={[styles.code, { color: colors.text }]}>{toFullCode(o.symbol)}</Text>
            <Text style={[styles.tag, { color: o.side === 'buy' ? colors.up : colors.down }]}>
              {SIDE_TEXT[o.side]}
            </Text>
          </View>
          <View style={styles.itemMid}>
            <Cell label="委托价" value={o.price.toFixed(2)} color={colors.textSecondary} />
            <Cell label="数量" value={`${o.quantity}`} color={colors.textSecondary} />
            <Cell label="已成交" value={`${o.filledQty}`} color={colors.textSecondary} />
            <Cell label="状态" value={STATUS_TEXT[o.status] ?? o.status} color={colors.textSecondary} />
          </View>
          {o.message ? <Text style={[styles.msg, { color: colors.down }]}>{o.message}</Text> : null}
        </View>
      ))}
    </>
  );
}

function TradesTab({ trades, colors }: { trades: Trade[]; colors: ReturnType<typeof useAppTheme>['colors'] }): React.JSX.Element {
  if (trades.length === 0) return <Empty text="暂无成交" colors={colors} />;
  return (
    <>
      {trades.map((t) => {
        const fee = calcFee(t.side, t.amount);
        return (
          <View key={t.id} style={[styles.item, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.itemTop}>
              <Text style={[styles.code, { color: colors.text }]}>{toFullCode(t.symbol)}</Text>
              <Text style={[styles.tag, { color: t.side === 'buy' ? colors.up : colors.down }]}>
                {SIDE_TEXT[t.side]} {t.price.toFixed(2)} × {t.quantity}
              </Text>
            </View>
            <View style={styles.itemMid}>
              <Cell label="金额" value={t.amount.toFixed(2)} color={colors.textSecondary} />
              <Cell label="费用" value={fee.toFixed(2)} color={colors.textSecondary} />
              <Cell label="现金" value={`${t.cashDelta >= 0 ? '+' : ''}${t.cashDelta.toFixed(2)}`} color={colors.textSecondary} />
            </View>
          </View>
        );
      })}
    </>
  );
}

function Cell({ label, value, color }: { label: string; value: string; color: string }): React.JSX.Element {
  return (
    <View style={styles.cell}>
      <Text style={[styles.cellLabel, { color }]}>{label}</Text>
      <Text style={[styles.cellValue, { color }]}>{value}</Text>
    </View>
  );
}

function Empty({ text, colors }: { text: string; colors: ReturnType<typeof useAppTheme>['colors'] }): React.JSX.Element {
  return (
    <View style={[styles.empty, { backgroundColor: colors.surface }]}>
      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  summaryCard: { borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  label: { fontSize: fontSize.sm },
  total: { fontSize: fontSize.title, fontWeight: '800', marginVertical: spacing.sm },
  row2: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  metric: { flex: 1, alignItems: 'center' },
  metricLabel: { fontSize: fontSize.xs, marginBottom: 2 },
  metricValue: { fontSize: fontSize.md, fontWeight: '700' },
  tabs: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, marginBottom: spacing.sm },
  tab: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  tabActive: { borderBottomWidth: 2 },
  tabText: { fontSize: fontSize.md, fontWeight: '600' },
  tabSpacer: { flex: 1 },
  resetText: { fontSize: fontSize.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  item: { borderRadius: radius.md, borderWidth: 1, padding: spacing.md, marginBottom: spacing.sm },
  itemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  code: { fontSize: fontSize.md, fontWeight: '700' },
  tag: { fontSize: fontSize.sm, fontWeight: '700' },
  pnl: { fontSize: fontSize.md, fontWeight: '700' },
  itemMid: { flexDirection: 'row', justifyContent: 'space-between' },
  cell: { alignItems: 'center' },
  cellLabel: { fontSize: fontSize.xs, marginBottom: 2 },
  cellValue: { fontSize: fontSize.sm, fontWeight: '600' },
  msg: { fontSize: fontSize.xs, marginTop: spacing.xs },
  empty: { borderRadius: radius.md, padding: spacing.xl, alignItems: 'center' },
  emptyText: { fontSize: fontSize.md },
});
