/**
 * 价格/涨跌文本：自动按涨红跌绿着色。
 * 用法：<PriceText value={10.5} /> <ChangePct pct={1.2} />
 */
import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useAppTheme } from '@/theme/ThemeProvider';
import { fontSize } from '@/theme';

export function PriceText({
  value,
  style,
  digits = 2,
}: {
  value: number | null | undefined;
  style?: object;
  digits?: number;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const txt = value == null || !Number.isFinite(value) ? '--' : value.toFixed(digits);
  return <Text style={[styles.price, { color: colors.text }, style]}>{txt}</Text>;
}

export function ChangePct({
  pct,
  style,
  digits = 2,
}: {
  pct: number | null | undefined;
  style?: object;
  digits?: number;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const valid = pct != null && Number.isFinite(pct);
  const color = !valid ? colors.flat : pct! >= 0 ? colors.up : colors.down;
  const txt = !valid ? '--' : `${pct! >= 0 ? '+' : ''}${pct!.toFixed(digits)}%`;
  return <Text style={[{ color }, style ?? { fontSize: fontSize.md }]}>{txt}</Text>;
}

const styles = StyleSheet.create({
  price: { fontSize: fontSize.md },
});
