/** 自选雷达摘要行（Opptrix watchlistRadar） */
import React, { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useAppTheme } from '@/theme/ThemeProvider';
import { fontSize } from '@/theme';
import { scoreGrade } from '@/quant/decisionCard';
import { peekIndustryOf } from '@/quant/industryMap';
import { useSignals } from '@/hooks/useSignals';

export function formatRadarLine(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' · ');
}

export function WatchRadarLine({
  symbolKey,
  industry,
  extraVal,
  extraFlow,
}: {
  symbolKey: string;
  industry?: string | null;
  extraVal?: string | null;
  extraFlow?: string | null;
}): React.JSX.Element | null {
  const { colors } = useAppTheme();
  const { buys, sells } = useSignals();
  const [line, setLine] = useState('');

  useEffect(() => {
    const [code, exchange] = symbolKey.split('.');
    const ind = industry || (code && exchange ? peekIndustryOf(code, exchange) : null);
    const all = [...buys, ...sells];
    const sig = all.find((s) => s.symbolKey === symbolKey);
    const grade = sig ? scoreGrade(sig.strength) : null;
    const bias = sig ? (sig.side === 'buy' ? '偏多' : sig.side === 'sell' ? '偏空' : '中性') : null;
    const next = formatRadarLine([
      ind && ind !== '未分类' ? ind : null,
      grade ? `${grade}` : null,
      bias,
      extraVal || null,
      extraFlow || null,
    ]);
    setLine(next);
  }, [symbolKey, industry, extraVal, extraFlow, buys, sells]);

  if (!line) return null;
  return (
    <Text style={[styles.line, { color: colors.textSecondary }]} numberOfLines={1}>
      {line}
    </Text>
  );
}

const styles = StyleSheet.create({
  line: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
});
