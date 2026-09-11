/**
 * 首页市场情绪条：交易状态 + 涨停/跌停家数（可开关）。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { marketData, type MarketSessionStatus } from '@/data/api';
import { spacing, fontSize, fontWeight } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { Card } from '@/components';

const STATUS_LABEL: Record<MarketSessionStatus, string> = {
  pre_market: '盘前',
  open: '交易中',
  lunch_break: '午间休市',
  after_hours: '盘后',
  closed: '已收盘',
};

export function MarketMoodBar({ showLimit }: { showLimit: boolean }): React.JSX.Element | null {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const [status, setStatus] = useState<MarketSessionStatus | null>(null);
  const [limitUp, setLimitUp] = useState<number | null>(null);
  const [limitDown, setLimitDown] = useState<number | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const st = await marketData.getMarketStatus('A');
        if (alive) setStatus(st);
      } catch {
        if (alive) setErr(true);
      }
      if (!showLimit) return;
      try {
        // 不要只取 1 条：多数源不回 pagination.total，items.length 即家数
        const [up, down] = await Promise.all([
          marketData.getLimitUpPool({ size: 200 }),
          marketData.getLimitDownPool({ size: 200 }),
        ]);
        if (!alive) return;
        const total = (r: { items?: unknown[]; pagination?: { total?: number } } | unknown[] | undefined) => {
          if (!r) return null;
          if (Array.isArray(r)) return r.length;
          if (r.pagination?.total != null && r.pagination.total > 0) return r.pagination.total;
          return r.items?.length ?? 0;
        };
        setLimitUp(total(up as any));
        setLimitDown(total(down as any));
      } catch {
        // 涨跌停拉不到不阻断状态展示
      }
    })();
    return () => {
      alive = false;
    };
  }, [showLimit]);

  if (err && !showLimit) return null;

  const statusText = status ? STATUS_LABEL[status] : '—';
  const open = status === 'open';

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={styles.item}>
          <Text style={styles.label}>市场</Text>
          <Text style={[styles.value, { color: open ? colors.up : colors.textSecondary }]}>{statusText}</Text>
        </View>
        {showLimit && (
          <>
            <View style={styles.divider} />
            <View style={styles.item}>
              <Text style={styles.label}>涨停</Text>
              <Text style={[styles.value, { color: colors.up }]}>{limitUp == null ? '—' : String(limitUp)}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.item}>
              <Text style={styles.label}>跌停</Text>
              <Text style={[styles.value, { color: colors.down }]}>{limitDown == null ? '—' : String(limitDown)}</Text>
            </View>
          </>
        )}
      </View>
    </Card>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    card: { marginBottom: spacing.sm },
    row: { flexDirection: 'row', alignItems: 'center' },
    item: { flex: 1, alignItems: 'center' },
    divider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: colors.border },
    label: { color: colors.textSecondary, fontSize: fontSize.xs },
    value: { fontSize: fontSize.md, fontWeight: fontWeight.bold as any, marginTop: 2 },
  });
}
