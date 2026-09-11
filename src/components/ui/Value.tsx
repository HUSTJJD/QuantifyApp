/**
 * Value —— Ghostfolio 风格数值展示：大号主数字 + 次要标签 + 涨跌着色。
 * 用于资产总值、绩效指标、资金流等「一眼看清」场景。
 */
import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { useAppTheme } from '@/theme/ThemeProvider';
import { fontSize, fontWeight } from '@/theme';

export type ValueSize = 'sm' | 'md' | 'lg' | 'xl';

export function Value({
  value,
  label,
  subValue,
  color,
  size = 'lg',
  align = 'left',
  style,
  valueStyle,
}: {
  value: string | number;
  label?: string;
  /** 副文案（如百分比、区间） */
  subValue?: string;
  color?: string;
  size?: ValueSize;
  align?: 'left' | 'center' | 'right';
  style?: StyleProp<TextStyle>;
  valueStyle?: StyleProp<TextStyle>;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const sizeStyle =
    size === 'xl'
      ? styles.valueXl
      : size === 'lg'
        ? styles.valueLg
        : size === 'md'
          ? styles.valueMd
          : styles.valueSm;
  const alignStyle =
    align === 'center' ? styles.center : align === 'right' ? styles.right : styles.left;

  return (
    <View style={[styles.wrap, alignStyle, style]}>
      {label ? <Text style={[styles.label, alignStyle]}>{label}</Text> : null}
      <Text
        numberOfLines={1}
        style={[styles.value, sizeStyle, { color: color ?? colors.text }, valueStyle]}
      >
        {value}
      </Text>
      {subValue ? <Text style={[styles.sub, alignStyle]}>{subValue}</Text> : null}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    wrap: { marginVertical: 2 },
    left: { alignItems: 'flex-start', textAlign: 'left' },
    center: { alignItems: 'center', textAlign: 'center' },
    right: { alignItems: 'flex-end', textAlign: 'right' },
    label: {
      color: colors.textSecondary,
      fontSize: fontSize.xs,
      letterSpacing: 0.3,
      marginBottom: 2,
    },
    value: {
      fontWeight: fontWeight.heavy as any,
      letterSpacing: -0.3,
    },
    valueXl: { fontSize: 28 },
    valueLg: { fontSize: 22 },
    valueMd: { fontSize: 17 },
    valueSm: { fontSize: fontSize.sm },
    sub: {
      color: colors.textSecondary,
      fontSize: fontSize.xs,
      marginTop: 2,
    },
  });
}

export default Value;
