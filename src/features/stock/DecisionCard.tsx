/** 决策卡 UI（Opptrix StockDecisionCard 信息架构） */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, fontWeight, layout } from '@/theme';
import type { TradeSignal } from '@/quant/signals';
import {
  buildDecisionSummary,
  DECISION_LEGEND,
  type ScoreGrade,
} from '@/quant/decisionCard';

const GRADE_COLOR: Record<ScoreGrade, 'up' | 'down' | 'primary' | 'warning' | 'info'> = {
  A: 'up',
  'B+': 'primary',
  B: 'info',
  C: 'warning',
  D: 'down',
};

export function DecisionCard({
  signals,
  industry,
}: {
  signals: TradeSignal[];
  industry?: string;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const summary = useMemo(() => buildDecisionSummary(signals), [signals]);
  const gradeColorKey = GRADE_COLOR[summary.grade];
  const gradeColor = colors[gradeColorKey];
  const biasColor =
    summary.bias.label === '偏多' ? colors.up : summary.bias.label === '偏空' ? colors.down : colors.textSecondary;

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.badge, { backgroundColor: gradeColor }]}>
          <Text style={styles.badgeText}>{summary.grade}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>综合评分 {summary.score.toFixed(2)}</Text>
          <Text style={styles.sub}>
            {industry ? `${industry} · ` : ''}
            <Text style={{ color: biasColor }}>
              策略{summary.bias.label}（{summary.bias.buyCount}多 / {summary.bias.sellCount}空）
            </Text>
          </Text>
        </View>
      </View>

      {summary.thesis.length > 0 && (
        <View style={styles.block}>
          {summary.thesis.map((t, i) => (
            <Text key={`t${i}`} style={styles.bullet}>
              · {t}
            </Text>
          ))}
        </View>
      )}

      {summary.risks.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.riskLabel}>风险</Text>
          {summary.risks.map((t, i) => (
            <Text key={`r${i}`} style={[styles.bullet, { color: colors.warning }]}>
              · {t}
            </Text>
          ))}
        </View>
      )}

      <Text style={styles.legend}>{DECISION_LEGEND}</Text>
    </Card>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    card: { marginBottom: spacing.sm },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
    badge: {
      width: 40,
      height: 40,
      borderRadius: layout.radiusCard,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { color: '#fff', fontSize: fontSize.lg, fontWeight: fontWeight.heavy as any },
    title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
    sub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    block: { marginBottom: spacing.sm, gap: 2 },
    bullet: { color: colors.text, fontSize: fontSize.sm, lineHeight: 18 },
    riskLabel: { color: colors.warning, fontSize: fontSize.xs, fontWeight: '600', marginBottom: 2 },
    legend: {
      color: colors.textSecondary,
      fontSize: fontSize.xs,
      lineHeight: 14,
      marginTop: spacing.xs,
    },
  });
}
