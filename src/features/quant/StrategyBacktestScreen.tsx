/**
 * 策略回测报告页（可信化闭环）：
 *  - 自选股池批量回测汇总
 *  - 单标的详报：权益曲线 vs 沪深300、绩效、成交明细
 *  - 样本内 / 样本外（walk-forward）对比
 *  - 因子参数网格扫描 TopN，可一键应用最优
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getProfile, upsertProfile } from '@/quant/profileStore';
import { paramSpecsOf } from '@/quant/profile';
import type { StrategyProfile } from '@/quant/profile';
import { strategyOfProfile } from '@/quant/profile';
import type { BacktestResult, BacktestTrade } from '@/quant/backtest';
import { runBacktest } from '@/quant/backtest';
import { loadBacktestSeries, prepareCandles } from '@/quant/backtestData';
import { alignByDate, computeBenchmarkMetrics, type BenchmarkMetrics } from '@/quant/benchmark';
import { walkForward, type WalkForwardResult } from '@/quant/walkForward';
import { gridSearch, type OptimizeEntry } from '@/quant/optimize';
import { buildScanGrid, strategyWithParams, formatParamCombo } from '@/quant/paramScan';
import { getGroups } from '@/data/repositories/WatchlistRepository';
import type { Symbol, Candle } from '@/data/api';
import { displaySymbol } from '@/domain';
import { spacing, fontSize, fontWeight } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { Card, LineGraphView } from '@/components';

const HS300: Symbol = { code: '000300', exchange: 'SH', name: '沪深300' };
const POOL_CAP = 6;
const BAR_COUNT = 320;

interface Row {
  symbol: Symbol;
  ok: boolean;
  result?: BacktestResult;
  candles?: Candle[];
  reason?: string;
  /** 复权链路说明 */
  adjustNote?: string;
}

type Detail = {
  symbol: Symbol;
  result: BacktestResult;
  candles: Candle[];
  alignedNav: { strategyNav: number; benchmarkNav: number }[];
  benchMetrics: BenchmarkMetrics | null;
  walk: WalkForwardResult | null;
  benchNote?: string;
  adjustNote?: string;
};

function fmtPct(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function fmtNum(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function StrategyBacktestScreen({
  onBack,
  strategyId,
}: {
  onBack?: () => void;
  strategyId: string;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<StrategyProfile | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(true);
  const [note, setNote] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState('');
  const [scanTop, setScanTop] = useState<OptimizeEntry[]>([]);
  const [applying, setApplying] = useState<string | null>(null);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    (async () => {
      const p = await getProfile(strategyId);
      if (!p) {
        setRunning(false);
        return;
      }
      setProfile(p);
      const groups = await getGroups();
      const seen = new Set<string>();
      const pool: Symbol[] = [];
      for (const g of groups) {
        for (const s of g.symbols ?? []) {
          const key = `${s.code}_${s.exchange}`;
          if (seen.has(key)) continue;
          seen.add(key);
          pool.push(s);
        }
      }
      const capped = pool.slice(0, POOL_CAP);
      if (capped.length === 0) {
        setNote('选股池为空：先在自选股中添加股票');
        setRunning(false);
        return;
      }
      const out: Row[] = [];
      let initCash = 100_000;
      try {
        const { getAppPrefs } = await import('@/settings/appPrefs');
        initCash = (await getAppPrefs()).defaultInitCash;
      } catch {
        // 默认 10 万
      }
      for (const symbol of capped) {
        try {
          // 可信链路：不复权 + 本地因子，除权日事件调整现金/股数
          const series = await loadBacktestSeries(symbol, {
            period: p.trade.period,
            count: BAR_COUNT,
            adjustMode: 'raw-events',
          });
          const prepared = prepareCandles(series.candles, { minBars: 30 });
          if (!prepared.ok) {
            out.push({ symbol, ok: false, reason: prepared.reason ?? '历史数据不足' });
          } else {
            const result = runBacktest(strategyOfProfile(p), prepared.candles, {
              initCash,
              positionRatio: p.trade.positionRatio,
              exit: p.exit,
              corporateActions: series.factors,
            });
            out.push({ symbol, ok: true, result, candles: prepared.candles, adjustNote: series.note });
          }
        } catch {
          out.push({ symbol, ok: false, reason: '数据拉取失败' });
        }
        setRows([...out]);
      }
      setNote(
        `样本：自选前 ${capped.length} 只 · 近 ${BAR_COUNT} 根 · 不复权+除权事件回放${capped.length < pool.length ? `（另有 ${pool.length - capped.length} 只未参与）` : ''}`,
      );
      setRunning(false);
    })().catch(() => setRunning(false));
  }, [strategyId]);

  const loadDetail = useCallback(
    async (row: Row) => {
      if (!profile || !row.ok || !row.result || !row.candles) return;
      const key = `${row.symbol.code}_${row.symbol.exchange}`;
      setSelectedKey(key);
      setDetailLoading(true);
      setDetail(null);
      setScanTop([]);
      setScanNote('');
      try {
        const candles = row.candles;
        const result = row.result;
        // 基准：沪深300 日K（指数无复权语义；仍走可信取数）
        let benchCandles: Candle[] = [];
        let benchNote: string | undefined;
        try {
          const benchSeries = await loadBacktestSeries(HS300, {
            period: 'day',
            count: BAR_COUNT,
            adjustMode: 'none',
          });
          benchCandles = benchSeries.candles;
          if (benchSeries.factorCount === 0) {
            // 指数无因子是预期
            benchNote = undefined;
          }
        } catch {
          benchNote = '沪深300 数据不可用';
        }
        const points = benchCandles.length > 0 ? alignByDate(result.equity, candles, benchCandles) : [];
        const benchMetrics = points.length >= 2 ? computeBenchmarkMetrics(points) : null;
        const walk = walkForward(strategyOfProfile(profile), candles, {
          initCash: 100_000,
          positionRatio: profile.trade.positionRatio,
          exit: profile.exit,
          trainRatio: 0.7,
        });
        setDetail({
          symbol: row.symbol,
          result,
          candles,
          alignedNav: points.map((p) => ({ strategyNav: p.strategyNav, benchmarkNav: p.benchmarkNav })),
          benchMetrics,
          walk,
          benchNote,
          adjustNote: row.adjustNote,
        });
      } finally {
        setDetailLoading(false);
      }
    },
    [profile],
  );

  // 默认选中第一条成功结果
  useEffect(() => {
    if (running || selectedKey || detailLoading) return;
    const first = rows.find((r) => r.ok);
    if (first) loadDetail(first).catch(() => undefined);
  }, [running, rows, selectedKey, detailLoading, loadDetail]);

  const runParamScan = useCallback(async () => {
    if (!profile || !detail) return;
    setScanning(true);
    setScanNote('');
    setScanTop([]);
    try {
      const specs = paramSpecsOf(profile.templateId);
      const grid = buildScanGrid(specs, profile.params, 2);
      if (!grid) {
        setScanNote('该策略无可扫描参数');
        return;
      }
      const entries = gridSearch(
        (params) => strategyWithParams(profile, params),
        detail.candles,
        grid,
        {
          metric: 'totalReturnPct',
          topN: 5,
          initCash: 100_000,
          positionRatio: profile.trade.positionRatio,
          exit: profile.exit,
        },
      );
      setScanTop(entries);
      const keys = Object.keys(grid).map((k) => (k.includes('.') ? k.slice(k.indexOf('.') + 1) : k)).join(' × ');
      setScanNote(`扫描 ${keys}（${entries.length ? `共 ${Object.values(grid).reduce((s, a) => s * a.length, 1)} 组` : '0 组'}）· 按收益 Top${Math.min(5, entries.length)}`);
    } finally {
      setScanning(false);
    }
  }, [profile, detail]);

  const applyParams = useCallback(
    async (params: Record<string, number>) => {
      if (!profile) return;
      setApplying(formatParamCombo(params));
      try {
        const next: StrategyProfile = {
          ...profile,
          params: { ...profile.params, ...params },
          updatedAt: Date.now(),
        };
        await upsertProfile(next);
        setProfile(next);
        setScanNote(`已写入档案：${formatParamCombo(params)}。返回策略页可见。`);
      } finally {
        setApplying(null);
      }
    },
    [profile],
  );

  const okRows = rows.filter((r) => r.ok && r.result);
  const avgRet = okRows.length > 0 ? okRows.reduce((s, r) => s + (r.result!.totalReturnPct ?? 0), 0) / okRows.length : 0;
  const avgWin = okRows.length > 0 ? okRows.reduce((s, r) => s + (r.result!.winRate ?? 0), 0) / okRows.length : 0;
  const avgDd = okRows.length > 0 ? okRows.reduce((s, r) => s + (r.result!.maxDrawdownPct ?? 0), 0) / okRows.length : 0;
  const totalTrades = okRows.reduce((s, r) => s + (r.result?.trades.length ?? 0), 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>回测报告</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {!profile ? (
          <Text style={styles.centerText}>策略不存在</Text>
        ) : (
          <>
            <Text style={styles.title}>{profile.name}</Text>
            <Text style={styles.desc}>
              止盈 {profile.exit.takeProfitPct || '关'}% · 止损 {profile.exit.stopLossPct || '关'}% · 移动止损{' '}
              {profile.exit.trailingPct || '关'}% · 仓位 {(profile.trade.positionRatio * 100).toFixed(0)}%
            </Text>

            <Card style={styles.summary}>
              <Text style={styles.summaryTitle}>
                {running ? '批量回测中…' : `池汇总（成功 ${okRows.length}/${rows.length}）`}
              </Text>
              {!running && okRows.length > 0 && (
                <View style={styles.statRow}>
                  <SummaryCol value={fmtPct(avgRet)} label="平均收益" color={avgRet >= 0 ? colors.up : colors.down} />
                  <SummaryCol value={`${avgWin.toFixed(0)}%`} label="平均胜率" color={colors.text} />
                  <SummaryCol value={`${avgDd.toFixed(1)}%`} label="平均回撤" color={colors.warning} />
                  <SummaryCol value={String(totalTrades)} label="总成交" color={colors.text} />
                </View>
              )}
              {!running && okRows.length === 0 && (
                <Text style={styles.desc}>没有可用结果{note ? `（${note}）` : ''}</Text>
              )}
              {note ? <Text style={styles.desc}>{note}</Text> : null}
            </Card>

            {rows.map((r, i) => {
              const key = `${r.symbol.code}_${r.symbol.exchange}`;
              const active = key === selectedKey;
              const ret = r.result?.totalReturnPct;
              const color = ret == null ? colors.textSecondary : ret >= 0 ? colors.up : colors.down;
              return (
                <Card
                  key={i}
                  padded={false}
                  style={[styles.rowCard, active && { borderColor: colors.primary, borderWidth: 1 }]}
                  onPress={r.ok ? () => loadDetail(r).catch(() => undefined) : undefined}
                >
                  <View style={styles.rowMain}>
                    <View style={styles.rowLeft}>
                      <Text style={styles.rowName}>
                        {displaySymbol(r.symbol)}
                        {active ? ' · 详报' : ''}
                      </Text>
                      <Text style={styles.rowSub}>
                        {r.ok && r.result
                          ? `交易 ${r.result.trades.length} 笔 · 胜率 ${r.result.winRate.toFixed(0)}% · 回撤 ${r.result.maxDrawdownPct.toFixed(1)}% · 夏普 ${fmtNum(r.result.sharpe)}`
                          : r.reason ?? '失败'}
                      </Text>
                    </View>
                    {r.ok && r.result && (
                      <Text style={[styles.rowRet, { color }]}>{fmtPct(ret!, 2)}</Text>
                    )}
                  </View>
                </Card>
              );
            })}

            {detailLoading && (
              <Card style={styles.summary}>
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.desc}>详报生成中…</Text>
                </View>
              </Card>
            )}

            {detail && !detailLoading && (
              <>
                <Text style={styles.sectionTitle}>详报 · {displaySymbol(detail.symbol)}</Text>

                <Card>
                  <Text style={styles.cardTitle}>权益 vs 沪深300（归一化=100）</Text>
                  <LineGraphView
                    values={detail.alignedNav.map((p) => p.strategyNav)}
                    valuesB={detail.alignedNav.map((p) => p.benchmarkNav)}
                    labelA="策略"
                    labelB="沪深300"
                    trendingUp={detail.result.totalReturnPct >= 0}
                    colorB={colors.textSecondary}
                    height={160}
                    enableGradient={false}
                  />
                  {detail.adjustNote ? <Text style={styles.desc}>复权：{detail.adjustNote}</Text> : null}
                  {detail.benchNote ? <Text style={styles.desc}>{detail.benchNote}</Text> : null}
                  {detail.result.corpEvents.length > 0 && (
                    <Text style={styles.desc}>
                      除权事件 {detail.result.corpEvents.length} 次：
                      {detail.result.corpEvents
                        .slice(0, 3)
                        .map((e) => e.note)
                        .join('；')}
                      {detail.result.corpEvents.length > 3 ? '…' : ''}
                    </Text>
                  )}
                </Card>

                <Card>
                  <Text style={styles.cardTitle}>绩效</Text>
                  <View style={styles.statRow}>
                    <SummaryCol
                      value={fmtPct(detail.result.totalReturnPct)}
                      label="总收益"
                      color={detail.result.totalReturnPct >= 0 ? colors.up : colors.down}
                    />
                    <SummaryCol value={fmtPct(detail.result.annualizedReturnPct)} label="年化" color={colors.text} />
                    <SummaryCol value={`${detail.result.maxDrawdownPct.toFixed(1)}%`} label="最大回撤" color={colors.warning} />
                    <SummaryCol value={fmtNum(detail.result.sharpe)} label="夏普" color={colors.text} />
                  </View>
                  <View style={[styles.statRow, { marginTop: spacing.sm }]}>
                    <SummaryCol value={`${detail.result.winRate.toFixed(0)}%`} label="胜率" color={colors.text} />
                    <SummaryCol
                      value={Number.isFinite(detail.result.profitFactor) ? detail.result.profitFactor.toFixed(2) : '∞'}
                      label="盈亏比"
                      color={colors.text}
                    />
                    <SummaryCol value={fmtNum(detail.result.totalFees, 0)} label="总费用" color={colors.textSecondary} />
                    <SummaryCol value={String(detail.result.trades.length)} label="成交" color={colors.text} />
                  </View>
                  {detail.benchMetrics && (
                    <>
                      <View style={styles.divider} />
                      <Text style={styles.cardSubTitle}>相对沪深300</Text>
                      <View style={styles.statRow}>
                        <SummaryCol
                          value={fmtPct(detail.benchMetrics.benchmarkReturnPct)}
                          label="基准收益"
                          color={colors.textSecondary}
                        />
                        <SummaryCol
                          value={fmtPct(detail.benchMetrics.excessReturnPct)}
                          label="超额"
                          color={detail.benchMetrics.excessReturnPct >= 0 ? colors.up : colors.down}
                        />
                        <SummaryCol value={fmtNum(detail.benchMetrics.informationRatio)} label="信息比率" color={colors.text} />
                        <SummaryCol value={`${detail.benchMetrics.trackingErrorPct.toFixed(1)}%`} label="跟踪误差" color={colors.textSecondary} />
                      </View>
                    </>
                  )}
                </Card>

                <Card>
                  <Text style={styles.cardTitle}>样本内 / 样本外</Text>
                  {!detail.walk ? (
                    <Text style={styles.desc}>K 线不足以做 70/30 划分</Text>
                  ) : (
                    <>
                      <View style={styles.wfRow}>
                        <View style={styles.wfCol}>
                          <Text style={styles.wfLabel}>样本内收益</Text>
                          <Text
                            style={[
                              styles.wfValue,
                              { color: detail.walk.train.totalReturnPct >= 0 ? colors.up : colors.down },
                            ]}
                          >
                            {fmtPct(detail.walk.train.totalReturnPct)}
                          </Text>
                          <Text style={styles.wfSub}>夏普 {fmtNum(detail.walk.train.sharpe)}</Text>
                        </View>
                        <View style={styles.wfCol}>
                          <Text style={styles.wfLabel}>样本外收益</Text>
                          <Text
                            style={[
                              styles.wfValue,
                              { color: detail.walk.val.totalReturnPct >= 0 ? colors.up : colors.down },
                            ]}
                          >
                            {fmtPct(detail.walk.val.totalReturnPct)}
                          </Text>
                          <Text style={styles.wfSub}>夏普 {fmtNum(detail.walk.val.sharpe)}</Text>
                        </View>
                      </View>
                      <Text style={[styles.desc, detail.walk.likelyOverfit && { color: colors.down }]}>
                        {detail.walk.likelyOverfit
                          ? `疑似过拟合：收益衰减 ${detail.walk.returnDecayPct.toFixed(0)}%、夏普衰减 ${detail.walk.sharpeDecayPct.toFixed(0)}%。样本外失效时勿直接实盘。`
                          : `收益衰减 ${detail.walk.returnDecayPct.toFixed(0)}% · 夏普衰减 ${detail.walk.sharpeDecayPct.toFixed(0)}%（未触发过拟合阈值）`}
                      </Text>
                    </>
                  )}
                </Card>

                <Card>
                  <View style={styles.cardHeadRow}>
                    <Text style={styles.cardTitle}>成交明细</Text>
                    <Text style={styles.desc}>{detail.result.trades.length} 笔</Text>
                  </View>
                  {detail.result.trades.length === 0 ? (
                    <Text style={styles.desc}>区间内无成交</Text>
                  ) : (
                    detail.result.trades
                      .slice(-12)
                      .reverse()
                      .map((t, i) => <TradeRow key={i} trade={t} colors={colors} styles={styles} />)
                  )}
                  {detail.result.trades.length > 12 && (
                    <Text style={styles.desc}>仅显示最近 12 笔</Text>
                  )}
                </Card>

                <Card>
                  <View style={styles.cardHeadRow}>
                    <Text style={styles.cardTitle}>参数扫描</Text>
                    <TouchableOpacity onPress={() => runParamScan().catch(() => undefined)} disabled={scanning} hitSlop={8}>
                      <Text style={[styles.link, scanning && { color: colors.textSecondary }]}>
                        {scanning ? '扫描中…' : '开始扫描'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.desc}>
                    在当前参数邻域（±1 步长，最多 2 个键）网格回测，按收益排序。仅历史拟合，存在过拟合风险。
                  </Text>
                  {scanNote ? <Text style={styles.desc}>{scanNote}</Text> : null}
                  {scanTop.map((e, i) => (
                    <View key={i} style={styles.scanRow}>
                      <View style={styles.scanLeft}>
                        <Text style={styles.scanRank}>#{i + 1}</Text>
                        <Text style={styles.scanParams}>{formatParamCombo(e.params)}</Text>
                      </View>
                      <View style={styles.scanRight}>
                        <Text
                          style={[
                            styles.rowRet,
                            { color: e.result.totalReturnPct >= 0 ? colors.up : colors.down },
                          ]}
                        >
                          {fmtPct(e.result.totalReturnPct)}
                        </Text>
                        <TouchableOpacity onPress={() => applyParams(e.params).catch(() => undefined)} disabled={!!applying} hitSlop={6}>
                          <Text style={styles.link}>{applying === formatParamCombo(e.params) ? '写入中…' : '应用'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </Card>
              </>
            )}

            <Text style={styles.hint}>
              成本模型：A 股默认佣金（万 2.5，最低 5 元）、印花税（卖出 0.05%）、过户费（0.001%），收盘价近似撮合。
              复权：不复权 K 线 + 本地复权因子，除权日按分红/送转调整现金与股数（不使用上游已复权价）。结果用于策略对比，不代表未来收益。
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function TradeRow({
  trade,
  colors,
  styles,
}: {
  trade: BacktestTrade;
  colors: ReturnType<typeof useAppTheme>['colors'];
  styles: ReturnType<typeof makeStyles>;
}): React.JSX.Element {
  const isBuy = trade.side === 'buy';
  return (
    <View style={styles.tradeRow}>
      <View style={styles.tradeLeft}>
        <Text style={[styles.tradeSide, { color: isBuy ? colors.up : colors.down }]}>{isBuy ? '买入' : '卖出'}</Text>
        <Text style={styles.tradeDate}>{fmtDate(trade.time)}</Text>
      </View>
      <Text style={styles.tradeMid}>
        {trade.price.toFixed(2)} × {trade.shares}
      </Text>
      <Text style={styles.tradeFee}>费 {trade.fee.toFixed(1)}</Text>
    </View>
  );
}

function SummaryCol({ value, label, color }: { value: string; label: string; color: string }): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.summaryCol}>
      <Text style={[styles.summaryNum, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.md, paddingBottom: spacing.xxl },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    back: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
    headerTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold as any },
    title: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.heavy as any },
    desc: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 4, lineHeight: 16 },
    centerText: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center', paddingVertical: spacing.xl },

    summary: { marginTop: spacing.md },
    summaryTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
    statRow: { flexDirection: 'row', marginTop: spacing.md },
    summaryCol: { flex: 1, alignItems: 'center' },
    summaryNum: { fontSize: fontSize.md, fontWeight: fontWeight.heavy as any },
    summaryLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },

    sectionTitle: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold as any,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    cardTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
    cardSubTitle: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: spacing.sm },
    cardHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md },
    loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

    rowCard: { marginTop: spacing.sm },
    rowMain: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    rowLeft: { flex: 1, marginRight: spacing.md },
    rowName: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
    rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    rowRet: { fontSize: fontSize.md, fontWeight: fontWeight.heavy as any },

    wfRow: { flexDirection: 'row', marginTop: spacing.sm, gap: spacing.md },
    wfCol: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, backgroundColor: colors.background, borderRadius: 8 },
    wfLabel: { color: colors.textSecondary, fontSize: fontSize.xs },
    wfValue: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy as any, marginTop: 2 },
    wfSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },

    tradeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    tradeLeft: { width: 110 },
    tradeSide: { fontSize: fontSize.sm, fontWeight: '600' },
    tradeDate: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    tradeMid: { flex: 1, color: colors.text, fontSize: fontSize.sm },
    tradeFee: { color: colors.textSecondary, fontSize: fontSize.xs },

    scanRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      marginTop: spacing.xs,
    },
    scanLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
    scanRank: { color: colors.textSecondary, fontSize: fontSize.xs, width: 22 },
    scanParams: { color: colors.text, fontSize: fontSize.sm, flexShrink: 1 },
    scanRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    link: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '600' },

    hint: {
      color: colors.textSecondary,
      fontSize: fontSize.xs,
      lineHeight: 16,
      marginTop: spacing.lg,
      paddingHorizontal: spacing.sm,
    },
  });
}
