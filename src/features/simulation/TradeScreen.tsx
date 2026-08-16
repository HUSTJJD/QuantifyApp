/**
 * 交易下单页：模拟盘买卖下单。
 * 支持市价/限价、整手数量、快捷仓位（1/4、1/2、全仓/全部资金），T+1 可用校验。
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, radius } from '@/theme';
import { useSimAccount } from '@/hooks/useSimAccount';
import { toFullCode } from '@/domain';
import {
  LOT_SIZE,
  round2,
  roundShare,
  calcFee,
  type Side,
  type OrderType,
  type SubmitResult,
} from '@/simulation';
import type { Symbol } from '@/api';

export function TradeScreen({
  symbol,
  lastPrice,
  onDone,
}: {
  symbol: Symbol;
  lastPrice: number;
  onDone?: () => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const { account, buy, sell } = useSimAccount();

  const [side, setSide] = useState<Side>('buy');
  const [type, setType] = useState<OrderType>('limit');
  const [priceStr, setPriceStr] = useState<string>(lastPrice > 0 ? lastPrice.toFixed(2) : '');
  const [qtyStr, setQtyStr] = useState<string>('');

  const price = type === 'market' ? lastPrice : parseFloat(priceStr) || 0;
  const qty = parseInt(qtyStr, 10) || 0;

  const position = account?.positions.find(
    (p) => p.symbol.code === symbol.code && p.symbol.exchange === symbol.exchange,
  );
  const cash = account?.cash ?? 0;
  const availableShares = position?.available ?? 0;

  const estAmount = round2(price * roundShare(qty));
  const estFee = calcFee(side, estAmount);
  const estTotal = side === 'buy' ? round2(estAmount + estFee) : round2(estAmount - estFee);

  const maxByCash = useMemo(() => {
    if (price <= 0) return 0;
    const perShare = price + (price * 0.00025 + 5 + price * 0.0001);
    return roundShare(Math.floor(cash / perShare));
  }, [price, cash]);
  const maxByHold = availableShares;

  const quickQty = (ratio: number) => {
    const base = side === 'buy' ? maxByCash : maxByHold;
    setQtyStr(String(roundShare(Math.floor(base * ratio))));
  };

  const submit = async () => {
    if (qty <= 0) {
      Alert.alert('提示', '请输入有效数量（整手 100 股的倍数）');
      return;
    }
    if (side === 'buy' && estTotal > round2(cash)) {
      Alert.alert('资金不足', `需要 ${estTotal.toFixed(2)} 元，可用 ${cash.toFixed(2)} 元`);
      return;
    }
    const res: SubmitResult = await (side === 'buy' ? buy : sell)(symbol, price, qty, type, lastPrice);
    if (res.ok) {
      Alert.alert('委托成功', `${side === 'buy' ? '买入' : '卖出'} ${toFullCode(symbol)} ${qty} 股，已成交`, [
        { text: '完成', onPress: onDone },
      ]);
    } else {
      Alert.alert('委托失败', res.message ?? '下单失败');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>模拟交易 · {toFullCode(symbol)}</Text>
      </View>

      {/* 买卖切换 */}
      <View style={styles.sideRow}>
        <SideBtn label="买入" active={side === 'buy'} color={colors.up} onPress={() => setSide('buy')} />
        <SideBtn label="卖出" active={side === 'sell'} color={colors.down} onPress={() => setSide('sell')} />
      </View>

      {/* 价格类型 */}
      <View style={styles.typeRow}>
        <TypeBtn label="限价" active={type === 'limit'} colors={colors} onPress={() => setType('limit')} />
        <TypeBtn label="市价" active={type === 'market'} colors={colors} onPress={() => setType('market')} />
        {type === 'market' ? (
          <Text style={[styles.hint, { color: colors.textSecondary }]}>以最新价 {lastPrice.toFixed(2)} 成交</Text>
        ) : null}
      </View>

      {/* 价格输入 */}
      {type === 'limit' ? (
        <View style={[styles.field, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>委托价</Text>
          <TextInput
            style={[styles.input, { color: colors.text }]}
            keyboardType="decimal-pad"
            value={priceStr}
            onChangeText={setPriceStr}
            placeholder="0.00"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
      ) : null}

      {/* 数量输入 */}
      <View style={[styles.field, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>数量（股，{LOT_SIZE}股/手）</Text>
        <TextInput
          style={[styles.input, { color: colors.text }]}
          keyboardType="number-pad"
          value={qtyStr}
          onChangeText={setQtyStr}
          placeholder="0"
          placeholderTextColor={colors.textSecondary}
        />
      </View>

      {/* 快捷仓位 */}
      <View style={styles.quickRow}>
        {[0.25, 0.5, 1].map((r) => (
          <TouchableOpacity
            key={r}
            style={[styles.quick, { borderColor: colors.border }]}
            onPress={() => quickQty(r)}
          >
            <Text style={[styles.quickText, { color: colors.textSecondary }]}>
              {r === 1 ? (side === 'buy' ? '全资金' : '全持仓') : `${r * 100}%`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[styles.info, { color: colors.textSecondary }]}>
        预计{side === 'buy' ? '占用' : '收回'}：{estTotal.toFixed(2)} 元（含费用约 {estFee.toFixed(2)}）
        {'\n'}可用现金：{cash.toFixed(2)} 元 · 可用持仓：{availableShares} 股
      </Text>

      <TouchableOpacity
        style={[styles.submit, { backgroundColor: side === 'buy' ? colors.up : colors.down }]}
        onPress={submit}
      >
        <Text style={styles.submitText}>{side === 'buy' ? '买入下单' : '卖出下单'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function SideBtn({ label, active, color, onPress }: { label: string; active: boolean; color: string; onPress: () => void }): React.JSX.Element {
  return (
    <TouchableOpacity
      style={[styles.sideBtn, active ? styles.sideBtnActive : null]}
      onPress={onPress}
    >
      <Text style={[styles.sideBtnText, { color: active ? color : styles.sideBtnInactive.color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function TypeBtn({ label, active, colors, onPress }: { label: string; active: boolean; colors: ReturnType<typeof useAppTheme>['colors']; onPress: () => void }): React.JSX.Element {
  return (
    <TouchableOpacity
      style={[styles.typeBtn, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.surfaceAlt : colors.surface }]}
      onPress={onPress}
    >
      <Text style={[styles.typeBtnText, { color: active ? colors.primary : colors.textSecondary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.md },
  header: { borderBottomWidth: 1, paddingBottom: spacing.sm, marginBottom: spacing.md },
  title: { fontSize: fontSize.lg, fontWeight: '700' },
  sideRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#333', marginBottom: spacing.md },
  sideBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.xl, alignItems: 'center' },
  sideBtnActive: { borderBottomWidth: 2 },
  sideBtnInactive: { color: '#888' },
  sideBtnText: { fontSize: fontSize.lg, fontWeight: '700' },
  typeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  typeBtn: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginRight: spacing.sm },
  typeBtnText: { fontSize: fontSize.sm },
  hint: { fontSize: fontSize.xs },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.sm },
  fieldLabel: { fontSize: fontSize.sm, width: 120 },
  input: { flex: 1, fontSize: fontSize.lg, textAlign: 'right' },
  quickRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  quick: { flex: 1, marginHorizontal: spacing.xs, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: 'center' },
  quickText: { fontSize: fontSize.sm },
  info: { fontSize: fontSize.xs, lineHeight: 18, marginBottom: spacing.lg },
  submit: { borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  submitText: { color: '#fff', fontSize: fontSize.lg, fontWeight: '700' },
});
