/**
 * 策略回测报告页（可信化闭环）：
 *  - 按档案选股范围批量回测汇总（watchlist=自选 / scan=最近扫描命中）
 *  - 单标的详报：权益曲线 vs 沪深300 / 买入持有、绩效、成交明细
 *  - 样本内 / 样本外（walk-forward）对比
 *  - 因子参数网格扫描 TopN，可一键应用最优
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getProfile, upsertProfile } from '@/quant/profileStore';
import { allParamSpecsOf } from '@/quant/profile';
import type { StrategyProfile } from '@/quant/profile';
import { profileEvaluator } from '@/quant/profile';
import type { BacktestResult, BacktestOptions, BacktestTrade } from '@/quant/backtest';
import { runBacktest } from '@/quant/backtest';
import {
  backtestConfigKey,
  backtestOptsKey,
  getCachedBacktest,
  putCachedBacktest,
} from '@/quant/backtestCache';
import { loadBacktestSeries, prepareCandles } from '@/quant/backtestData';
import type { AdjustmentFactorInput } from '@/quant/adjustment';
import { barsPerYearOfPeriod } from '@/quant/metrics';
import { combinePortfolio, type CombinedPortfolio } from '@/quant/portfolio';
import { runPortfolioBacktest, type PortfolioBacktestResult } from '@/quant/portfolioBacktest';
import { alignByDate, computeBenchmarkMetrics, type BenchmarkMetrics } from '@/quant/benchmark';
import { walkForward, type WalkForwardResult } from '@/quant/walkForward';
import { gridSearch, type OptimizeEntry } from '@/quant/optimize';
import { buildScanGrid, strategyWithParams, formatParamCombo } from '@/quant/paramScan';
import { formatBacktestReport } from '@/quant/backtestReport';
import { runBuyHold, excessVsBuyHold, type BuyHoldMetrics } from '@/quant/buyHold';
import { resolvePool } from '@/quant/runtime';
import { UNIVERSE_LABEL } from '@/quant/profile';
import type { Symbol, Candle } from '@/data/api';
import { displaySymbol } from '@/domain';
import { spacing, fontSize, fontWeight } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { Card, LineGraphView } from '@/components';

const HS300: Symbol = { code: '000300', exchange: 'SH', name: '沪深300' };
const POOL_CAP = 12;
const BAR_COUNT = 320;
const SLIPPAGE_OPTIONS = [0, 5, 10];

interface Row {
  symbol: Symbol;
  ok: boolean;
  result?: BacktestResult;
  candles?: Candle[];
  reason?: string;
  /** 复权链路说明 */
  adjustNote?: string;
  /** 实际样本 bar 数 */
  bars?: number;
  /** 请求周期是否被真实满足（本地库仅存日K时分钟级会退化） */
  periodHonored?: boolean;
  /** 本地复权因子：样本内外划分 / 参数扫描 / 买入持有都要跟着主回测走同一套除权口径 */
  factors?: AdjustmentFactorInput[];
}

/**
 * 统一的回测参数基线。
 *
 * 修复点：过去主回测用「次日开盘 + 滑点 + 除权事件」，而样本内外划分、参数扫描
 * 却各自用默认配置（收盘价撮合、无成本、无公司行为），三者结果不可比——
 * 用户会看到「扫描最优参数」与「正式回测」对不上。这里统一出口。
 */
function baseBacktestOpts(
  p: StrategyProfile,
  cash: number,
  slippageBp: number,
  corporateActions?: AdjustmentFactorInput[],
): BacktestOptions {
  return {
    initCash: cash,
    positionRatio: p.trade.positionRatio,
    exit: p.exit,
    corporateActions,
    cost: { slippageBp },
    execution: 'nextOpen',
    barsPerYear: barsPerYearOfPeriod(p.trade.period),
  };
}

type Detail = {
  symbol: Symbol;
  result: BacktestResult;
  candles: Candle[];
  factors: AdjustmentFactorInput[];
  alignedNav: { strategyNav: number; benchmarkNav: number }[];
  benchMetrics: BenchmarkMetrics | null;
  walk: WalkForwardResult | null;
  buyHold: BuyHoldMetrics;
  buyHoldExcessPct: number;
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
  const [slippageBp, setSlippageBp] = useState(0);
  /** 真实组合回测的最大同时持仓数（资金竞争） */
  const [maxPositions, setMaxPositions] = useState(5);
  const [initCash, setInitCash] = useState(100_000);
  const [showAllTrades, setShowAllTrades] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  /** 详报请求令牌：快速切换标的时丢弃过期结果 */
  const detailToken = useRef(0);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  // 多标的等权合成：池回测是各标的独立 In&Out，这里补一层组合视角的净值/风险指标
  const portfolio = useMemo<CombinedPortfolio | null>(() => {
    const legs = rows
      .filter((r) => r.ok && r.result && r.candles)
      .map((r) => ({
        key: `${r.symbol.code}_${r.symbol.exchange}`,
        equity: r.result!.equity,
        candles: r.candles!,
      }));
    if (legs.length < 2) return null;
    return combinePortfolio(legs, profile ? barsPerYearOfPeriod(profile.trade.period) : 252);
  }, [rows, profile]);

  // 真实组合回测：共享资金 + maxPositions 资金竞争（与等权合成互为参照）
  const realPortfolio = useMemo<PortfolioBacktestResult | null>(() => {
    const legs = rows
      .filter((r) => r.ok && r.result && r.candles)
      .map((r) => ({
        key: `${r.symbol.code}_${r.symbol.exchange}`,
        equity: r.result!.equity,
      }));
    if (legs.length < 2) return null;
    const mp = Math.max(1, Math.min(maxPositions, legs.length));
    return runPortfolioBacktest(legs, { initCash: 100, maxPositions: mp, costPct: 0.00075 });
  }, [rows, maxPositions]);

  const realMp = realPortfolio ? Math.min(maxPositions, realPortfolio.legCount) : 0;

  const exportText = useMemo(() => {
    if (!profile || running || rows.length === 0) return '';
    return formatBacktestReport({
      profile,
      note,
      slippageBp,
      initCash,
      pool: rows.map((r) => ({ symbol: r.symbol, ok: r.ok, result: r.result, reason: r.reason })),
      detail: detail
        ? {
            symbol: detail.symbol,
            result: detail.result,
            benchMetrics: detail.benchMetrics,
            walk: detail.walk,
            adjustNote: detail.adjustNote,
            buyHold: detail.buyHold,
            buyHoldExcessPct: detail.buyHoldExcessPct,
          }
        : null,
      portfolio,
    });
  }, [profile, running, rows, note, slippageBp, initCash, detail, portfolio]);

  useEffect(() => {
    // 页面可能在批量回测/取样过程中被返回，未取消会在卸载后继续 setState
    let cancelled = false;
    (async () => {
      const p = await getProfile(strategyId);
      if (cancelled) return;
      if (!p) {
        setRunning(false);
        return;
      }
      setProfile(p);
      // 与自动交易同一选股池解析：watchlist=自选 / scan=最近扫描命中（过期回落自选）
      const pool = await resolvePool(p);
      const capped = pool.slice(0, POOL_CAP);
      if (cancelled) return;
      if (capped.length === 0) {
        setNote(
          p.selection.universe === 'scan'
            ? '扫描池为空：先跑一次全市场扫描，或切回自选股池'
            : '选股池为空：先在自选股中添加股票',
        );
        setRunning(false);
        return;
      }
      const out: Row[] = [];
      let cash0 = 100_000;
      try {
        const { getAppPrefs } = await import('@/settings/appPrefs');
        cash0 = (await getAppPrefs()).defaultInitCash;
      } catch {
        // 默认 10 万
      }
      setInitCash(cash0);
      let minBars = 0;
      let degraded = false;
      for (const symbol of capped) {
        if (cancelled) return;
        try {
          // 可信链路：不复权 + 本地因子，除权日事件调整现金/股数
          const series = await loadBacktestSeries(symbol, {
            period: p.trade.period,
            count: BAR_COUNT,
            // 窗口上限：本地库历史长度因人而异，限定样本才能横向比较
            maxBars: BAR_COUNT,
            adjustMode: 'raw-events',
          });
          if (cancelled) return;
          const prepared = prepareCandles(series.candles, { minBars: 30 });
          if (!prepared.ok) {
            out.push({ symbol, ok: false, reason: prepared.reason ?? '历史数据不足' });
          } else {
            const opts = baseBacktestOpts(p, cash0, slippageBp, series.factors);
            // 回测结果按「策略 + 配置 + 标的 + 样本」哈希缓存：再进页直接命中，不再全量重算
            const cacheKey = backtestConfigKey({
              dataKey: `${p.id}|${p.trade.period}|${symbol.code}.${symbol.exchange}|${series.barCount}|${JSON.stringify(
                { legs: p.legs, combineMode: p.combineMode, exit: p.exit, trade: p.trade, selection: p.selection },
              )}`,
              optsKey: backtestOptsKey(opts),
            });
            let result = await getCachedBacktest(cacheKey);
            if (!result) {
              result = runBacktest(profileEvaluator(p), prepared.candles, opts);
              await putCachedBacktest(cacheKey, result);
            }
            if (series.barCount > 0) {
              minBars = minBars === 0 ? series.barCount : Math.min(minBars, series.barCount);
            }
            if (series.periodHonored === false) degraded = true;
            out.push({
              symbol,
              ok: true,
              result,
              candles: prepared.candles,
              adjustNote: series.note,
              bars: series.barCount,
              periodHonored: series.periodHonored,
              factors: series.factors,
            });
          }
        } catch {
          out.push({ symbol, ok: false, reason: '数据拉取失败' });
        }
        if (cancelled) return;
        setRows([...out]);
      }
      const poolLabel = UNIVERSE_LABEL[p.selection.universe] ?? '自选股';
      const extra = capped.length < pool.length ? `（另有 ${pool.length - capped.length} 只未参与）` : '';
      // 样本用**真实** bar 数，不再写死「近 320 根」（本地/网络来源样本长短不同）
      setNote(
        `样本：${poolLabel}前 ${capped.length} 只 · ${minBars > 0 ? `${minBars} 根` : '—'} · 不复权+除权 · 次日开盘成交 · 滑点 ${slippageBp}bp${extra}` +
          (degraded ? ` · 注意：本地库仅存日K，${p.trade.period} 已退化为日K回放` : ''),
      );
      setRunning(false);
    })().catch(() => setRunning(false));
    return () => {
      cancelled = true;
    };
  }, [strategyId, slippageBp]);

  const loadDetail = useCallback(
    async (row: Row) => {
      if (!profile || !row.ok || !row.result || !row.candles) return;
      const key = `${row.symbol.code}_${row.symbol.exchange}`;
      const token = ++detailToken.current;
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
            maxBars: BAR_COUNT,
            adjustMode: 'none',
          });
          benchCandles = benchSeries.candles;
        } catch {
          benchNote = '沪深300 数据不可用';
        }
        const points = benchCandles.length > 0 ? alignByDate(result.equity, candles, benchCandles) : [];
        // 年化因子跟随策略周期，否则周/月/分钟 K 的年化超额与跟踪误差会失真
        const barsPerYear = barsPerYearOfPeriod(profile.trade.period);
        const benchMetrics =
          points.length >= 2 ? computeBenchmarkMetrics(points, barsPerYear) : null;
        if (!benchMetrics && points.length < 2 && !benchNote) {
          benchNote = '基准对齐点不足（可能与标的交易日历不匹配）';
        }
        // 样本内外划分与主回测同一套参数（含除权因子），否则 train/val 与正式结果不可比
        const factors = row.factors ?? [];
        const walk = walkForward(profileEvaluator(profile), candles, {
          ...baseBacktestOpts(profile, initCash, slippageBp, factors),
          trainRatio: 0.7,
        });
        // 买入持有必须与策略同口径：同费用模型、同撮合时机、同除权处理，
        // 否则「策略跑赢/跑输简单持有」的结论不可信
        const buyHold = runBuyHold(candles, {
          initCash,
          cost: { slippageBp },
          execution: 'nextOpen',
          corporateActions: factors,
        });
        if (detailToken.current !== token) return;
        setDetail({
          symbol: row.symbol,
          result,
          candles,
          factors,
          alignedNav: points.map((p) => ({ strategyNav: p.strategyNav, benchmarkNav: p.benchmarkNav })),
          benchMetrics,
          walk,
          buyHold,
          buyHoldExcessPct: excessVsBuyHold(result.totalReturnPct, buyHold.totalReturnPct),
          benchNote,
          adjustNote: row.adjustNote,
        });
        setShowAllTrades(false);
      } finally {
        if (detailToken.current === token) setDetailLoading(false);
      }
    },
    [profile, initCash, slippageBp],
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
      const specs = allParamSpecsOf(profile);
      const current: Record<string, number> = {};
      for (const leg of profile.legs) Object.assign(current, leg.params);
      const grid = buildScanGrid(specs, current, 2);
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
          ...baseBacktestOpts(profile, initCash, slippageBp, detail.factors),
        },
      );
      setScanTop(entries);
      const keys = Object.keys(grid).map((k) => (k.includes('.') ? k.slice(k.indexOf('.') + 1) : k)).join(' × ');
      setScanNote(`扫描 ${keys}（${entries.length ? `共 ${Object.values(grid).reduce((s, a) => s * a.length, 1)} 组` : '0 组'}）· 按收益 Top${Math.min(5, entries.length)}`);
    } finally {
      setScanning(false);
    }
  }, [profile, detail, initCash, slippageBp]);

  const applyParams = useCallback(
    async (params: Record<string, number>) => {
      if (!profile) return;
      setApplying(formatParamCombo(params));
      try {
        const next: StrategyProfile = {
          ...profile,
          legs: profile.legs.map((leg) => ({
            ...leg,
            params: { ...leg.params, ...params },
          })),
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
        <TouchableOpacity
          onPress={() => setExportOpen((v) => !v)}
          disabled={!exportText}
          hitSlop={8}
        >
          <Text style={[styles.exportBtn, !exportText && { color: colors.textSecondary }]}>
            {exportOpen ? '收起' : '导出'}
          </Text>
        </TouchableOpacity>
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
            <View style={styles.slipRow}>
              <Text style={styles.slipLabel}>滑点</Text>
              {SLIPPAGE_OPTIONS.map((bp) => (
                <TouchableOpacity
                  key={bp}
                  style={[styles.slipChip, slippageBp === bp && styles.slipChipOn]}
                  onPress={() => setSlippageBp(bp)}
                >
                  <Text style={[styles.slipText, slippageBp === bp && styles.slipTextOn]}>
                    {bp === 0 ? '无' : `${bp}bp`}
                  </Text>
                </TouchableOpacity>
              ))}
              <Text style={[styles.desc, { flex: 1, textAlign: 'right' }]}>次日开盘成交</Text>
            </View>

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

            {/* 池内收益对比条 */}
            {!running && okRows.length >= 2 && (
              <Card style={styles.summary}>
                <Text style={styles.cardTitle}>池内收益对比</Text>
                {(() => {
                  const ranked = [...okRows]
                    .map((r) => ({
                      key: `${r.symbol.code}_${r.symbol.exchange}`,
                      name: displaySymbol(r.symbol),
                      ret: r.result!.totalReturnPct,
                      dd: r.result!.maxDrawdownPct,
                    }))
                    .sort((a, b) => b.ret - a.ret);
                  const maxAbs = Math.max(...ranked.map((x) => Math.abs(x.ret)), 1);
                  return ranked.map((x) => {
                    const pctW = (Math.abs(x.ret) / maxAbs) * 100;
                    const pos = x.ret >= 0;
                    return (
                      <TouchableOpacity
                        key={x.key}
                        style={styles.cmpRow}
                        onPress={() => {
                          const row = okRows.find(
                            (r) => `${r.symbol.code}_${r.symbol.exchange}` === x.key,
                          );
                          if (row) loadDetail(row).catch(() => undefined);
                        }}
                        activeOpacity={0.75}
                      >
                        <Text style={styles.cmpName} numberOfLines={1}>
                          {x.name}
                        </Text>
                        <View style={styles.cmpBarWrap}>
                          <View
                            style={[
                              styles.cmpBar,
                              {
                                width: `${Math.max(4, pctW)}%`,
                                backgroundColor: pos ? colors.up : colors.down,
                                alignSelf: pos ? 'flex-start' : 'flex-end',
                              },
                            ]}
                          />
                        </View>
                        <Text style={[styles.cmpRet, { color: pos ? colors.up : colors.down }]}>
                          {fmtPct(x.ret, 1)}
                        </Text>
                      </TouchableOpacity>
                    );
                  });
                })()}
                <Text style={styles.desc}>点击行进入详报 · 条长按收益绝对值</Text>
              </Card>
            )}

            {/* 多标的组合视角（等权合成） */}
            {!running && portfolio && portfolio.nav.length > 0 && (
              <Card style={styles.summary}>
                <Text style={styles.cardTitle}>组合（等权合成 · {portfolio.legCount} 只）</Text>
                <LineGraphView
                  values={portfolio.nav}
                  labelA="组合净值(基准100)"
                  trendingUp={portfolio.metrics.totalReturnPct >= 0}
                  height={150}
                  enableGradient={false}
                />
                <View style={styles.statRow}>
                  <SummaryCol
                    value={fmtPct(portfolio.metrics.totalReturnPct)}
                    label="组合收益"
                    color={portfolio.metrics.totalReturnPct >= 0 ? colors.up : colors.down}
                  />
                  <SummaryCol value={fmtPct(portfolio.metrics.annualizedReturnPct)} label="年化" color={colors.text} />
                  <SummaryCol value={`${portfolio.metrics.maxDrawdownPct.toFixed(1)}%`} label="最大回撤" color={colors.warning} />
                  <SummaryCol value={fmtNum(portfolio.metrics.sharpe)} label="夏普" color={colors.text} />
                </View>
                <View style={[styles.statRow, { marginTop: spacing.sm }]}>
                  <SummaryCol value={fmtNum(portfolio.metrics.sortino)} label="索提诺" color={colors.text} />
                  <SummaryCol value={fmtNum(portfolio.metrics.calmar)} label="卡玛" color={colors.text} />
                  <SummaryCol value={`${portfolio.metrics.volatilityPct.toFixed(1)}%`} label="年化波动" color={colors.textSecondary} />
                  <SummaryCol value={`${portfolio.fullOverlapPct.toFixed(0)}%`} label="样本齐全度" color={colors.textSecondary} />
                </View>
                <Text style={styles.desc}>
                  各标的独立回测后按日收益等权合成，用于判断「分散后的整体风险收益」；
                  下方「真实组合」卡片支持共享资金池 + maxPositions 资金竞争，更接近实盘。
                  {portfolio.fullOverlapPct < 90 ? ' · 有标的样本区间不齐，缺数据当日按剩余标的等权' : ''}
                </Text>
              </Card>
            )}

            {/* 真实组合（资金竞争 · maxPositions） */}
            {!running && realPortfolio && (
              <Card style={styles.summary}>
                <Text style={styles.cardTitle}>真实组合（资金竞争 · 最多 {realMp} 只）</Text>
                <View style={styles.slipRow}>
                  <Text style={styles.slipLabel}>最大同时持仓</Text>
                  <TouchableOpacity style={styles.slipChip} onPress={() => setMaxPositions(Math.max(1, realMp - 1))}>
                    <Text style={styles.slipText}>－</Text>
                  </TouchableOpacity>
                  <Text style={[styles.slipText, { minWidth: 24, textAlign: 'center' }]}>{realMp}</Text>
                  <TouchableOpacity
                    style={styles.slipChip}
                    onPress={() => setMaxPositions(Math.min(realPortfolio.legCount, realMp + 1))}
                  >
                    <Text style={styles.slipText}>＋</Text>
                  </TouchableOpacity>
                  <Text style={[styles.desc, { flex: 1, textAlign: 'right' }]}>
                    {realMp >= realPortfolio.legCount
                      ? '（不限制）'
                      : `资金竞争：日均跳过 ${realPortfolio.skippedDaysPct.toFixed(0)}%`}
                  </Text>
                </View>
                <LineGraphView
                  values={realPortfolio.nav}
                  labelA="组合净值(基准100)"
                  trendingUp={realPortfolio.metrics.totalReturnPct >= 0}
                  height={150}
                  enableGradient={false}
                />
                <View style={styles.statRow}>
                  <SummaryCol
                    value={fmtPct(realPortfolio.metrics.totalReturnPct)}
                    label="组合收益"
                    color={realPortfolio.metrics.totalReturnPct >= 0 ? colors.up : colors.down}
                  />
                  <SummaryCol value={fmtPct(realPortfolio.metrics.annualizedReturnPct)} label="年化" color={colors.text} />
                  <SummaryCol value={`${realPortfolio.metrics.maxDrawdownPct.toFixed(1)}%`} label="最大回撤" color={colors.warning} />
                  <SummaryCol value={fmtNum(realPortfolio.metrics.sharpe)} label="夏普" color={colors.text} />
                </View>
                <View style={[styles.statRow, { marginTop: spacing.sm }]}>
                  <SummaryCol value={fmtNum(realPortfolio.avgPositions)} label="日均持仓" color={colors.text} />
                  <SummaryCol value={`${realPortfolio.exposurePct.toFixed(0)}%`} label="持仓覆盖" color={colors.textSecondary} />
                  <SummaryCol value={fmtNum(realPortfolio.metrics.sortino)} label="索提诺" color={colors.text} />
                  <SummaryCol value={fmtNum(realPortfolio.metrics.calmar)} label="卡玛" color={colors.text} />
                </View>
                <Text style={styles.desc}>
                  共享资金池 + 至多 {realMp} 只同时持仓：某日 &gt;{realMp} 只策略同时触发时按近期动量择优，被挤出者当日留现金（计换手成本）。
                </Text>
              </Card>
            )}

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
                  <Text style={styles.cardTitle}>策略 vs 买入持有（同标的）</Text>
                  <LineGraphView
                    values={detail.result.equity}
                    valuesB={detail.buyHold.equity}
                    labelA="策略"
                    labelB="买入持有"
                    trendingUp={detail.buyHoldExcessPct >= 0}
                    colorB={colors.textSecondary}
                    height={140}
                    enableGradient={false}
                  />
                  <View style={styles.statRow}>
                    <SummaryCol
                      value={fmtPct(detail.result.totalReturnPct)}
                      label="策略收益"
                      color={detail.result.totalReturnPct >= 0 ? colors.up : colors.down}
                    />
                    <SummaryCol
                      value={fmtPct(detail.buyHold.totalReturnPct)}
                      label="买入持有"
                      color={detail.buyHold.totalReturnPct >= 0 ? colors.up : colors.down}
                    />
                    <SummaryCol
                      value={fmtPct(detail.buyHoldExcessPct)}
                      label="超额"
                      color={detail.buyHoldExcessPct >= 0 ? colors.up : colors.down}
                    />
                  </View>
                  <View style={[styles.statRow, { marginTop: spacing.sm }]}>
                    <SummaryCol value={String(detail.buyHold.shares)} label="持有股数" color={colors.text} />
                    <SummaryCol value={fmtNum(detail.buyHold.buyFee, 0)} label="建仓费用" color={colors.textSecondary} />
                    <SummaryCol
                      value={String(detail.buyHold.corpEvents.length)}
                      label="除权调整"
                      color={colors.textSecondary}
                    />
                    <SummaryCol value={detail.buyHold.buyPrice.toFixed(2)} label="建仓价" color={colors.text} />
                  </View>
                  <Text style={styles.desc}>
                    买入持有：同资金 / 同费用 / 同撮合（次日开盘）/ 同除权口径，
                    {detail.buyHold.shares > 0
                      ? `一次性买入 ${detail.buyHold.shares} 股持有到期。`
                      : '未成交（资金不足一手或未到买入时点）。'}
                    {detail.buyHold.corpEvents.length > 0
                      ? ` 期间 ${detail.buyHold.corpEvents.length} 次分红/送转已计入。`
                      : ''}
                    {detail.buyHoldExcessPct < 0 ? ' · 策略跑输简单持有，检查成本/换手' : ''}
                  </Text>
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
                    <SummaryCol value={fmtNum(detail.result.sortino)} label="索提诺" color={colors.text} />
                    <SummaryCol value={fmtNum(detail.result.calmar)} label="卡玛" color={colors.text} />
                    <SummaryCol value={`${detail.result.volatilityPct.toFixed(1)}%`} label="年化波动" color={colors.textSecondary} />
                    <SummaryCol value={`${detail.result.longestDrawdownBars}`} label="最长回撤(根)" color={colors.warning} />
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
                  <View style={[styles.statRow, { marginTop: spacing.sm }]}>
                    <SummaryCol value={`${detail.result.exposurePct.toFixed(0)}%`} label="持仓占比" color={colors.text} />
                    <SummaryCol value={`${detail.result.avgHoldingBars.toFixed(1)}`} label="平均持有(根)" color={colors.text} />
                    <SummaryCol value={fmtPct(detail.result.bestTradePct)} label="最佳单笔" color={colors.up} />
                    <SummaryCol value={fmtPct(detail.result.worstTradePct)} label="最差单笔" color={colors.down} />
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
                      <View style={[styles.statRow, { marginTop: spacing.sm }]}>
                        <SummaryCol value={fmtNum(detail.benchMetrics.beta)} label="Beta" color={colors.text} />
                        <SummaryCol value={fmtPct(detail.benchMetrics.alphaAnnualPct)} label="年化Alpha" color={detail.benchMetrics.alphaAnnualPct >= 0 ? colors.up : colors.down} />
                        <SummaryCol value={fmtNum(detail.benchMetrics.correlation)} label="相关系数" color={colors.textSecondary} />
                        <SummaryCol value={fmtPct(detail.benchMetrics.annualizedExcessPct)} label="年化超额" color={colors.text} />
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
                    (showAllTrades
                      ? [...detail.result.trades].reverse()
                      : detail.result.trades.slice(-12).reverse()
                    ).map((t, i) => <TradeRow key={i} trade={t} colors={colors} styles={styles} />)
                  )}
                  {detail.result.trades.length > 12 && (
                    <TouchableOpacity onPress={() => setShowAllTrades((v) => !v)} hitSlop={8}>
                      <Text style={styles.link}>
                        {showAllTrades ? '收起' : `展开全部 ${detail.result.trades.length} 笔`}
                      </Text>
                    </TouchableOpacity>
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
              成本模型：A 股默认佣金（万 2.5，最低 5 元）、印花税（卖出 0.05%）、过户费（0.001%），信号收盘判定、次日开盘撮合。
              「组合（等权合成）」为各标的独立回测后的日收益等权合成，非真实组合实盘值。
              已知限制：暂无涨跌停撮合、流动性限制、T+1 日内交易约束（本地库仅存日K），后续接入分钟 K 时补齐。
              复权：不复权 K 线 + 本地复权因子，除权日按分红/送转调整现金与股数（不使用上游已复权价）。结果用于策略对比，不代表未来收益。
            </Text>

            {exportOpen && exportText ? (
              <Card style={{ marginTop: spacing.md }}>
                <Text style={styles.cardTitle}>导出文本（可长按复制）</Text>
                <ScrollView style={styles.exportScroll} nestedScrollEnabled>
                  <Text selectable style={styles.exportBody}>
                    {exportText}
                  </Text>
                </ScrollView>
              </Card>
            ) : null}
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
      {trade.side === 'sell' && trade.pnlPct != null ? (
        <Text style={[styles.tradeFee, { color: trade.pnlPct >= 0 ? colors.up : colors.down, width: 62, textAlign: 'right' }]}>
          {fmtPct(trade.pnlPct, 1)}
        </Text>
      ) : null}
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
    exportBtn: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
    exportScroll: { maxHeight: 220, marginTop: spacing.sm },
    exportBody: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 16 },
    title: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.heavy as any },
    desc: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 4, lineHeight: 16 },
    slipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    slipLabel: { color: colors.textSecondary, fontSize: fontSize.xs },
    slipChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: colors.surfaceAlt,
    },
    slipChipOn: { backgroundColor: colors.primary },
    slipText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
    slipTextOn: { color: '#fff' },
    centerText: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center', paddingVertical: spacing.xl },

    summary: { marginTop: spacing.md },
    summaryTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
    cmpRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.sm,
      gap: spacing.sm,
    },
    cmpName: { width: 72, color: colors.textSecondary, fontSize: fontSize.xs },
    cmpBarWrap: {
      flex: 1,
      height: 10,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 5,
      overflow: 'hidden',
      justifyContent: 'center',
    },
    cmpBar: { height: 8, borderRadius: 4 },
    cmpRet: { width: 56, textAlign: 'right', fontSize: fontSize.xs, fontWeight: '700' },
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
