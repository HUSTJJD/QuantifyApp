/**
 * AshareQuoteRow — A 股焦点榜行情行。
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { Quote, Symbol } from '@/data/api';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize } from '@/theme';
import { MiniDaySparkline } from '@/components/ui/MiniDaySparkline';
import { fullCodeOf, fmtPct, fmtPrice, quotePct } from './format';

interface Props {
  symbol: Symbol;
  name: string;
  sub?: string | null;
  quote?: Quote | null;
  fallbackPrice?: number | null;
  fallbackPct?: number | null;
  showSpark?: boolean;
  onPress: (symbol: Symbol) => void;
}

export function AshareQuoteRow({
  symbol,
  name,
  sub,
  quote,
  fallbackPrice,
  fallbackPct,
  showSpark = true,
  onPress,
}: Props): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);

  const hasQuote = !!quote && quote.last > 0;
  const price = hasQuote ? quote.last : fallbackPrice;
  const pct = hasQuote ? quotePct(quote) : fallbackPct;
  const hasPrice = price != null && Number.isFinite(price) && price > 0;
  const hasPct = pct != null && Number.isFinite(pct);
  const up = (pct ?? 0) >= 0;

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => onPress(symbol)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${name} ${fmtPct(hasPct ? pct : null)}`}
    >
      <View style={styles.left}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.code} numberOfLines={1}>
          {symbol.code}
          {sub ? ` · ${sub}` : ''}
        </Text>
      </View>
      <Text style={[styles.price, !hasPrice && styles.dim]}>
        {hasPrice ? fmtPrice(price, 2) : '--'}
      </Text>
      <Text
        style={[
          styles.pct,
          { color: hasPct ? (up ? colors.up : colors.down) : colors.flat },
        ]}
      >
        {hasPct ? fmtPct(pct) : '--'}
      </Text>
      {showSpark && hasQuote ? (
        <MiniDaySparkline
          quote={quote}
          width={52}
          height={24}
          color={up ? colors.up : colors.down}
        />
      ) : (
        <View style={styles.sparkPlaceholder} />
      )}
    </TouchableOpacity>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      minHeight: 52,
    },
    left: { flex: 1, marginRight: spacing.sm },
    name: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
    code: { color: colors.textSecondary, fontSize: fontSize.micro, marginTop: 2 },
    price: {
      color: colors.text,
      fontSize: fontSize.quote,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      minWidth: 64,
      textAlign: 'right',
      marginRight: spacing.sm,
    },
    pct: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      minWidth: 64,
      textAlign: 'right',
      marginRight: spacing.sm,
    },
    dim: { color: colors.flat },
    sparkPlaceholder: { width: 52, height: 24 },
  });
}
