/**
 * SessionClock — 沪港 / 欧 / 美 会话开休 + A股涨跌停压缩条。
 * A 股状态走 getMarketStatus；港美用本地时钟近似（节假日不精确）。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { marketData, type MarketSessionStatus } from '@/data/api';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize } from '@/theme';
import { chinaParts } from '@/utils/trading';

type SessionState = 'open' | 'closed' | 'pre' | 'unknown';

interface SessionItem {
  key: string;
  label: string;
  state: SessionState;
}

function partsInTz(d: Date, timeZone: string): { day: number; hour: number; minute: number } {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const wdMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const hour = parseInt(get('hour'), 10);
    const minute = parseInt(get('minute'), 10);
    return {
      day: wdMap[get('weekday')] ?? 0,
      hour: Number.isNaN(hour) ? 0 : hour,
      minute: Number.isNaN(minute) ? 0 : minute,
    };
  } catch {
    return chinaParts(d);
  }
}

function inWindow(mins: number, start: number, end: number): boolean {
  return mins >= start && mins <= end;
}

/** 港股近似：工作日 09:30–12:00 / 13:00–16:00 HKT */
function isHkOpen(d: Date): boolean {
  const { day, hour, minute } = partsInTz(d, 'Asia/Hong_Kong');
  if (day === 0 || day === 6) return false;
  const mins = hour * 60 + minute;
  return inWindow(mins, 9 * 60 + 30, 12 * 60) || inWindow(mins, 13 * 60, 16 * 60);
}

/** 美股近似：工作日 09:30–16:00 America/New_York（含夏令时由 TZ 处理） */
function isUsOpen(d: Date): boolean {
  const { day, hour, minute } = partsInTz(d, 'America/New_York');
  if (day === 0 || day === 6) return false;
  const mins = hour * 60 + minute;
  return inWindow(mins, 9 * 60 + 30, 16 * 60);
}

/** 欧洲近似：工作日 15:30–22:00 北京时间（泛欧，极粗） */
function isEuOpen(d: Date): boolean {
  const { day, hour, minute } = chinaParts(d);
  if (day === 0 || day === 6) return false;
  const mins = hour * 60 + minute;
  return inWindow(mins, 15 * 60 + 30, 22 * 60);
}

function mapASession(st: MarketSessionStatus | null): SessionState {
  if (!st) return 'unknown';
  if (st === 'open') return 'open';
  if (st === 'pre_market') return 'pre';
  return 'closed';
}

export function SessionClock(): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const [aStatus, setAStatus] = useState<MarketSessionStatus | null>(null);
  const [limitUp, setLimitUp] = useState<number | null>(null);
  const [limitDown, setLimitDown] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    marketData
      .getMarketStatus('A')
      .then((st) => {
        if (alive) setAStatus(st);
      })
      .catch(() => undefined);
    (async () => {
      try {
        const [up, down] = await Promise.all([
          marketData.getLimitUpPool({ size: 200 }),
          marketData.getLimitDownPool({ size: 200 }),
        ]);
        if (!alive) return;
        const total = (r: { items?: unknown[]; pagination?: { total?: number } } | unknown[] | undefined) => {
          if (!r) return null;
          if (Array.isArray(r)) return r.length;
          if (r.pagination?.total != null && r.pagination.total > 0) return r.pagination.total;
          return (r as { items?: unknown[] }).items?.length ?? 0;
        };
        setLimitUp(total(up as never));
        setLimitDown(total(down as never));
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const cnState = mapASession(aStatus);
  const items: SessionItem[] = [
    { key: 'cn', label: '沪港', state: cnState === 'open' || isHkOpen(now) ? 'open' : cnState },
    { key: 'eu', label: '欧', state: isEuOpen(now) ? 'open' : 'closed' },
    { key: 'us', label: '美', state: isUsOpen(now) ? 'open' : 'closed' },
  ];

  const aLive = cnState === 'open';

  return (
    <View style={styles.wrap}>
      <View style={styles.sessions}>
        {items.map((it) => {
          const active = it.state === 'open' || it.state === 'pre';
          return (
            <View key={it.key} style={styles.session}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: active ? colors.live : colors.flat,
                  },
                ]}
              />
              <Text style={[styles.sessionLabel, active && styles.sessionLabelActive]}>{it.label}</Text>
              <Text style={[styles.sessionState, active && { color: colors.live }]}>
                {it.state === 'open' ? '开' : it.state === 'pre' ? '盘前' : it.state === 'unknown' ? '—' : '休'}
              </Text>
            </View>
          );
        })}
      </View>
      <View style={styles.right}>
        {aLive && (
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        )}
        <View style={styles.limitRow}>
          <Text style={styles.limitLabel}>涨停</Text>
          <Text style={[styles.limitVal, { color: colors.up }]}>
            {limitUp == null ? '—' : String(limitUp)}
          </Text>
          <Text style={styles.limitLabel}>跌停</Text>
          <Text style={[styles.limitVal, { color: colors.down }]}>
            {limitDown == null ? '—' : String(limitDown)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginBottom: spacing.sm,
    },
    sessions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    session: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    sessionLabel: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
    sessionLabelActive: { color: colors.text },
    sessionState: { color: colors.textSecondary, fontSize: fontSize.micro },
    right: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    liveBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      backgroundColor: 'rgba(245,166,35,0.12)',
    },
    liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.live },
    liveText: {
      color: colors.live,
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 0.8,
    },
    limitRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    limitLabel: { color: colors.textSecondary, fontSize: fontSize.micro },
    limitVal: { fontSize: fontSize.xs, fontWeight: '700', fontVariant: ['tabular-nums'], marginRight: 4 },
  });
}
