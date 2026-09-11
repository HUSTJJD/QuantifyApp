/**
 * 个股详情页（同花顺风格布局）。
 *
 * 自上而下：
 *  1) 报价区：股票名+代码、实时价（特大字号涨跌色）、涨跌额/涨跌幅、
 *     关键指标 2×4 网格（今开/最高/成交量/换手、昨收/最低/成交额/振幅），
 *     右侧并列五档盘口（卖5→买5，红涨绿跌）；
 *  2) 周期切换：分时/日K/周K/月K（分时用 1m 分钟线近似渲染）；
 *  3) K 线图：主图 MA/BOLL + 副图 MACD/KDJ/RSI/WR 可切换，支持左滑追溯上市；
 *  4) 技术指标面板（MA/BOLL/RSI/MACD/KDJ 末端值）；
 *  5) 资金流向（主力净流入/北向/大单分层）；
 *  6) 基本面（估值 + 最新财报）；
 *  7) 新闻/公告聚合。
 * 底部吸底操作栏：加自选（★）/ 同花顺跳转 / 模拟交易。
 *
 * 指数 / 行业板块（isIndexSymbol）等非个股详情与个股不同：
 *   - 不显示五档盘口、资金流向、龙虎榜、基本面、新闻/公告、复权、模拟交易；
 *   - K 线下方改为「成分股」列表（含行情，点击进入对应个股详情）。
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, SafeAreaView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { marketData } from '@/data/api';
import { useKline, useQuotes } from '@/hooks/useMarketData';
import { useLocalKline } from '@/hooks/useLocalKline';
import type { AdjustMode } from '@/quant/adjustment';
import { displaySymbol, isIndexSymbol } from '@/domain';
import type { KlinePeriod, OrderBook, Symbol, Valuation, FinancialReport, Quote } from '@/data/api';
import { KLineChart, Card, Section } from '@/components';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, fontSize, radius, fontWeight } from '@/theme';
import { buildIndicatorOverlay, isIndicatorValid } from '@/features/stock/indicatorsOverlay';
import { DragonTigerPanel } from './DragonTigerPanel';
import { IndexConstituentsPanel } from './IndexConstituentsPanel';
import {
  toValuationView,
  latestReport,
  fmtMetric,
  fmtLarge,
  computeDerivedMetrics,
  computeEarningsGrowthPct,
  fmtPct,
} from '@/features/stock/fundamentals';
import {
  computeMainFlow,
  computeTierFlow,
  summarizeNorthbound,
  fmtFlow,
  tierOrder,
  TIER_LABEL,
  FlowTick,
  NorthboundFlow,
} from '@/features/stock/capitalFlow';
import { buildNewsFeed, NormalizedNews } from '@/features/stock/news';
import { NewsItem, AnnouncementItem } from '@/data/api/types';
import { getWatchlist, addToWatchlist, removeFromWatchlist } from '@/data/repositories/WatchlistRepository';
import { openThsDetail } from '@/utils/thsDeepLink';

/** 周期 tab：分时 + 日/周/月 */
type ChartTab = '1m' | 'day' | 'week' | 'month';

/** 主图指标切换 */
const MAIN_INDICATORS = [
  { key: 'ma', label: 'MA' },
  { key: 'boll', label: 'BOLL' },
] as const;
/** 副图指标（ECharts 面板） */
const SUB_INDICATORS = [
  { key: 'volume', label: '成交量' },
  { key: 'macd', label: 'MACD' },
  { key: 'kdj', label: 'KDJ' },
  { key: 'rsi', label: 'RSI' },
  { key: 'wr', label: 'WR' },
  { key: 'none', label: '隐藏' },
] as const;

/** 复权选项（前复权/后复权/不复权；本地计算） */
const ADJUST_OPTIONS: { key: AdjustMode; label: string }[] = [
  { key: 'forward', label: '前复权' },
  { key: 'backward', label: '后复权' },
  { key: 'none', label: '不复权' },
];

/** 取数组末尾有效值（跳过 NaN）。 */
function lastValid(arr: number[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (isIndicatorValid(arr[i])) return arr[i];
  }
  return null;
}

/** 成交量/额格式化（万/亿） */
function fmtVol(v: number): string {
  if (!v || v <= 0) return '--';
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return String(Math.round(v));
}

export function StockDetailScreen({
  symbol,
  onBack,
  onTrade,
  onOpenSymbol,
  capitalFlowTicks,
  northbound,
  earningsGrowthPct,
  news,
  announcements,
}: {
  symbol: Symbol;
  onBack?: () => void;
  onTrade?: (symbol: Symbol, lastPrice: number) => void;
  /** 打开另一个标的（如成分股）的详情，供 push 到同一 Detail 路由 */
  onOpenSymbol?: (s: Symbol) => void;
  /** 个股主力资金流切片（可选，由上游行情源归一化后传入） */
  capitalFlowTicks?: FlowTick[];
  /** 北向资金（沪深股通净买入，可选） */
  northbound?: { shNetBuy?: number | null; szNetBuy?: number | null };
  /** 盈利同比增速（百分比数值，如 25 表示 +25%），用于 PEG 计算（可选） */
  earningsGrowthPct?: number | null;
  /** 个股相关新闻（可选） */
  news?: NewsItem[];
  /** 个股相关公告（可选） */
  announcements?: AnnouncementItem[];
}): React.JSX.Element {
  const { colors: c } = useAppTheme();
  const insets = useSafeAreaInsets();

  // 指数 / 行业板块（非个股）：隐藏个股专属栏目（盘口/资金流/龙虎榜/基本面/新闻公告等），改为成分股列表
  const isIndex = isIndexSymbol(symbol);
  // 同花顺板块指数（.TI）：各行情源均不覆盖 TI 分钟K（hithsa 指数仅日/周/月、stock-sdk 直拒 .TI、
  // fuyao 指数仅日线），无分时能力 → 隐藏「分时」入口并视 1m 为 day，避免必败请求刷错误日志。
  const boardIndex = isIndex && symbol.exchange === 'TI';
  // 页面被其它路由覆盖/切换时暂停行情轮询
  const focused = useIsFocused();

  // 周期 / 指标 / 复权状态
  const [tab, setTab] = useState<ChartTab>('day');
  const [mainInd, setMainInd] = useState<'ma' | 'boll'>('ma');
  const [subInd, setSubInd] = useState<'volume' | 'macd' | 'kdj' | 'rsi' | 'wr' | 'none'>('volume');
  const [adjustMode, setAdjustMode] = useState<AdjustMode>('forward');

  // TI 板块指数视 1m 为 day，避免对不支持的能力发请求
  const effectiveTab: ChartTab = tab === '1m' && boardIndex ? 'day' : tab;

  // 数据源：分时(1m) 走网络 useKline；日/周/月 走本地 useLocalKline（本地聚合周月 + 复权）
  const { data: quote } = useQuotes([symbol], 'stock', focused);
  const isIntraday = effectiveTab === '1m';
  const { data: klineNet, loading: loadingNet, error: errorNet, reload: reloadNet, loadEarlier } = useKline({
    symbol,
    period: effectiveTab as KlinePeriod,
    count: 240,
    // 分时/日线网络拉取统一用不复权；周/月走本地聚合不复权（本地复权由 useLocalKline 处理）
    adjust: 'none',
  });
  const { data: klineLocal, loading: loadingLocal, error: errorLocal, reload: reloadLocal } = useLocalKline(
    symbol,
    effectiveTab as KlinePeriod,
    adjustMode,
    effectiveTab === 'day' ? 500 : 300,
  );
  const kline = isIntraday ? klineNet : klineLocal;
  const loading = isIntraday ? loadingNet : loadingLocal;
  const error = isIntraday ? errorNet : errorLocal;
  const [book, setBook] = useState<OrderBook | null>(null);
  const [valuation, setValuation] = useState<Valuation | null>(null);
  const [reports, setReports] = useState<FinancialReport[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [watched, setWatched] = useState(false);
  // 指数/板块：下拉刷新时递增，驱动成分股面板重拉
  const [constituentsKey, setConstituentsKey] = useState(0);

  const q: Quote | undefined = quote && quote.length > 0 ? quote[0] : undefined;
  const cur = q ? q.last : kline && kline.length > 0 ? kline[kline.length - 1].close : 0;
  const prevClose = q ? q.prevClose : kline && kline.length > 1 ? kline[kline.length - 2].close : cur;
  const change = q?.change ?? (prevClose ? cur - prevClose : 0);
  const changePct = q?.changePct ?? (prevClose ? (change / prevClose) * 100 : 0);
  const upColor = change >= 0 ? c.up : c.down;

  const loadBook = useCallback(() => {
    let alive = true;
    marketData
      .getOrderBook(symbol)
      .then((b) => alive && setBook(b))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [symbol]);

  const loadFundamentals = useCallback(() => {
    marketData
      .getValuations([symbol])
      .then((vs) => setValuation(vs?.[0] ?? null))
      .catch(() => setValuation(null));
    marketData
      .getFinancials(symbol.code)
      .then((rs) => setReports(rs ?? []))
      .catch(() => setReports([]));
  }, [symbol]);

  // 指数/板块无个股语义，不请求盘口与基本面
  useEffect(() => {
    if (isIndex) return undefined;
    return loadBook();
  }, [loadBook, isIndex]);
  useEffect(() => {
    if (isIndex) return;
    loadFundamentals();
  }, [loadFundamentals, isIndex]);

  // 自选状态
  useEffect(() => {
    let alive = true;
    getWatchlist()
      .then((list) => alive && setWatched(list.some((s) => s.code === symbol.code && s.exchange === symbol.exchange)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [symbol]);

  const onToggleWatch = useCallback(async () => {
    if (watched) {
      await removeFromWatchlist(symbol);
      setWatched(false);
    } else {
      await addToWatchlist(symbol);
      setWatched(true);
    }
  }, [watched, symbol]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await (isIntraday ? reloadNet() : reloadLocal());
      if (isIndex) {
        // 指数/板块：刷新成分股列表（含其行情）
        setConstituentsKey((k) => k + 1);
      } else {
        loadBook();
        loadFundamentals();
      }
    } finally {
      setRefreshing(false);
    }
  }, [isIntraday, isIndex, reloadNet, reloadLocal, loadBook, loadFundamentals]);

  // 指标面板（基于 K 线末端值）
  const overlay = useMemo(() => (kline && kline.length ? buildIndicatorOverlay(kline) : null), [kline]);
  const metrics = useMemo(() => (reports.length ? latestReport(reports) : null), [reports]);
  const valView = valuation ? toValuationView(valuation) : null;
  // 盈利同比增速：优先用上层传入的 earningsGrowthPct；否则由已拉取的财报（最近两期净利同比）估算，供 PEG 使用。
  const growthPct = useMemo(
    () => (typeof earningsGrowthPct === 'number' ? earningsGrowthPct : computeEarningsGrowthPct(reports)),
    [earningsGrowthPct, reports],
  );
  const derived = useMemo(
    () => computeDerivedMetrics(valView, metrics, { earningsGrowthPct: growthPct }),
    [valView, metrics, growthPct],
  );

  const styles = makeStyles(c);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* ── 头部：返回 + 名称代码 + 自选 ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name={Icons.chevronRight} size={24} color={c.text} style={{ transform: [{ rotate: '180deg' }] }} />
        </TouchableOpacity>
        <View style={styles.titleBox}>
          <Text style={styles.title}>{displaySymbol(symbol, symbol.name)}</Text>
          <Text style={styles.codeText}>{symbol.code} {symbol.exchange}</Text>
        </View>
        <TouchableOpacity onPress={onToggleWatch} style={styles.watchBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name={watched ? Icons.star : Icons.starOutline} size={24} color={watched ? c.warning : c.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[c.primary]} tintColor={c.primary} />
        }
      >
        {/* ── 报价区：实时价 + 关键指标 + 五档盘口 ── */}
        <View style={[styles.quoteCard, { backgroundColor: upColor }]}>
          <View style={styles.quoteTop}>
            <View style={styles.quoteLeft}>
              <Text style={styles.priceText}>{cur > 0 ? cur.toFixed(2) : '--'}</Text>
              <View style={styles.changeRow}>
                <Text style={styles.changeText}>{change > 0 ? '+' : ''}{change.toFixed(2)}</Text>
                <Text style={styles.changeText}>{changePct > 0 ? '+' : ''}{changePct.toFixed(2)}%</Text>
              </View>
            </View>
            {!isIndex && book && (book.bids.length > 0 || book.asks.length > 0) ? (
              <View style={styles.bookCol}>
                {book.asks.slice().reverse().map((a, i) => (
                  <View key={`a${i}`} style={styles.bookRow}>
                    <Text style={styles.bookSide}>卖{i + 1}</Text>
                    <Text style={styles.bookPrice}>{a.price.toFixed(2)}</Text>
                    <Text style={styles.bookVol}>{fmtVol(a.volume)}</Text>
                  </View>
                ))}
                {book.bids.map((b, i) => (
                  <View key={`b${i}`} style={styles.bookRow}>
                    <Text style={styles.bookSide}>买{i + 1}</Text>
                    <Text style={styles.bookPrice}>{b.price.toFixed(2)}</Text>
                    <Text style={styles.bookVol}>{fmtVol(b.volume)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {/* 关键指标 2×4 网格 */}
          <View style={styles.quoteGrid}>
            <GridItem label="今开" value={q?.open ? q.open.toFixed(2) : '--'} />
            <GridItem label="最高" value={q?.high ? q.high.toFixed(2) : '--'} />
            <GridItem label="成交量" value={q ? fmtVol(q.volume) : '--'} />
            <GridItem label="振幅" value={q?.amplitudePct != null ? `${q.amplitudePct.toFixed(2)}%` : '--'} />
            <GridItem label="昨收" value={prevClose ? prevClose.toFixed(2) : '--'} />
            <GridItem label="最低" value={q?.low ? q.low.toFixed(2) : '--'} />
            <GridItem label="成交额" value={q ? fmtVol(q.amount) : '--'} />
            <GridItem label="涨跌额" value={q?.change != null ? `${q.change > 0 ? '+' : ''}${q.change.toFixed(2)}` : '--'} />
          </View>
        </View>

        {/* ── 周期切换：分时/日K/周K/月K（板块指数无分时） ── */}
        <View style={styles.periodRow}>
          {!boardIndex && (
            <TabBtn label="分时" active={effectiveTab === '1m'} onPress={() => setTab('1m')} />
          )}
          <TabBtn label="日K" active={effectiveTab === 'day'} onPress={() => setTab('day')} />
          <TabBtn label="周K" active={effectiveTab === 'week'} onPress={() => setTab('week')} />
          <TabBtn label="月K" active={effectiveTab === 'month'} onPress={() => setTab('month')} />
          <View style={styles.indSwitchRow}>
            <IndSwitch label={MAIN_INDICATORS[0].label} active={mainInd === 'ma'} onPress={() => setMainInd('ma')} />
            <IndSwitch label={MAIN_INDICATORS[1].label} active={mainInd === 'boll'} onPress={() => setMainInd('boll')} />
          </View>
        </View>
        {/* 副图指标切换 */}
        <View style={styles.subIndRow}>
          {SUB_INDICATORS.map((s) => (
            <IndSwitch key={s.key} label={s.label} active={subInd === s.key} onPress={() => setSubInd(s.key)} small />
          ))}
        </View>


        {/* 复权选项行（日/周/月 本地复权计算；分时无复权；指数/板块无复权语义） */}
        {!isIntraday && !isIndex && (
          <View style={styles.adjustRow}>
            <Text style={styles.adjustLabel}>复权</Text>
            {ADJUST_OPTIONS.map((a) => (
              <IndSwitch key={a.key} label={a.label} active={adjustMode === a.key} onPress={() => setAdjustMode(a.key)} small />
            ))}
          </View>
        )}

        {/* ── K 线图 ── */}
        <View style={styles.chartBox}>
          {loading && <Text style={styles.hint}>加载中…</Text>}
          {error && <Text style={styles.error}>{error}</Text>}
          {!loading && !error && kline && (
            <KLineChart
              data={kline}
              period={effectiveTab as KlinePeriod}
              height={280}
              mainIndicator={mainInd}
              subIndicator={subInd}
              onLoadMore={isIntraday ? loadEarlier : undefined}
            />
          )}
          {!loading && !error && kline && kline.length === 0 && <Text style={styles.hint}>该周期暂无数据</Text>}
        </View>

        {/* ── 技术指标面板 ── */}
        {overlay && effectiveTab !== '1m' && (
          <Card style={styles.indCard}>
            <View style={styles.indHead}>
              <Icon name={Icons.chart} size={2} color="primary" style={styles.indHeadIcon} />
              <Text style={styles.indHeadText}>技术指标</Text>
            </View>
            <View style={styles.indRow}>
              {overlay.mas.map((m) => {
                const v = lastValid(m.line.values);
                return (
                  <Text key={m.period} style={styles.indItem}>
                    MA{m.period} <Text style={styles.indVal}>{v == null ? '--' : v.toFixed(2)}</Text>
                  </Text>
                );
              })}
            </View>
            <View style={styles.indRow}>
              <Text style={styles.indItem}>BOLL <Text style={styles.indVal}>{fmtBoll(overlay)}</Text></Text>
              <Text style={styles.indItem}>RSI <Text style={styles.indVal}>{fmtNum(lastValid(overlay.rsi.values))}</Text></Text>
            </View>
            <View style={styles.indRow}>
              <Text style={styles.indItem}>MACD <Text style={styles.indVal}>{fmtNum(lastValid(overlay.macd.dif))}/{fmtNum(lastValid(overlay.macd.dea))}</Text></Text>
              <Text style={styles.indItem}>KDJ <Text style={styles.indVal}>{fmtNum(lastValid(overlay.kdj.k))}/{fmtNum(lastValid(overlay.kdj.d))}/{fmtNum(lastValid(overlay.kdj.j))}</Text></Text>
            </View>
          </Card>
        )}

        {isIndex ? (
          <>
            {/* ── 指数/板块：成分股 ── */}
            <Section title="成分股" />
            <IndexConstituentsPanel
              symbol={symbol}
              refreshKey={constituentsKey}
              onOpenSymbol={onOpenSymbol}
            />
          </>
        ) : (
          <>
        {/* ── 资金流向 ── */}
        <Section title="资金流向" />
        <Card style={styles.flowCard}>
          {capitalFlowTicks && capitalFlowTicks.length > 0 ? (
            <CapitalFlowPanel ticks={capitalFlowTicks} northbound={northbound} />
          ) : (
            <Text style={styles.hint}>该标的暂无资金流数据</Text>
          )}
        </Card>

        {/* ── 龙虎榜 ── */}
        <Section title="龙虎榜" />
        <DragonTigerPanel symbol={symbol} />

        {/* ── 基本面：估值 + 财务 ── */}
        <Section title="基本面" />
        <Card style={styles.fundCard}>
          <Text style={styles.fundSub}>估值</Text>
          {valView ? (
            <View style={styles.fundGrid}>
              <FundItem label="PE(TTM)" value={fmtMetric(valView.peTtm)} />
              <FundItem label="PE(静)" value={fmtMetric(valView.peMrq)} />
              <FundItem label="PB" value={fmtMetric(valView.pbMrq)} />
              <FundItem label="PS(TTM)" value={fmtMetric(valView.psTtm)} />
              <FundItem label="PEG" value={derived.peg !== null ? fmtMetric(derived.peg) : '--'} />
              <FundItem label="ROE" value={fmtPct(derived.roe)} />
              <FundItem label="毛利率" value={fmtPct(derived.grossMargin)} />
              <FundItem label="净利率" value={fmtPct(derived.netMargin)} />
            </View>
          ) : (
            <Text style={styles.hint}>暂无估值数据</Text>
          )}
          <Text style={[styles.fundSub, { marginTop: spacing.sm }]}>财务（最新报告期）</Text>
          {metrics ? (
            <View style={styles.fundGrid}>
              <FundItem label="EPS" value={fmtMetric(metrics.eps)} />
              <FundItem label="营收" value={fmtLarge(metrics.operatingIncome)} />
              <FundItem label="净利" value={fmtLarge(metrics.netProfit)} />
              <FundItem label="经营现金流" value={fmtLarge(metrics.operatingCashFlow)} />
            </View>
          ) : (
            <Text style={styles.hint}>暂无财报数据</Text>
          )}
        </Card>

        {/* ── 新闻 / 公告聚合 ── */}
        <Section title="新闻 / 公告" />
        <Card style={styles.flowCard}>
          {(() => {
            const feed = buildNewsFeed(news, announcements);
            if (feed.length === 0) return <Text style={styles.hint}>该标的暂无新闻/公告</Text>;
            return (
              <View>
                {feed.slice(0, 8).map((it: NormalizedNews, i: number) => (
                  <View key={`${it.kind}-${i}-${it.title}`} style={styles.newsRow}>
                    <Text style={[styles.tag, { color: it.kind === 'announcement' ? c.up : c.textSecondary }]}>
                      {it.kind === 'announcement' ? '公告' : '新闻'}
                    </Text>
                    <View style={styles.newsBody}>
                      <Text style={styles.newsTitle} numberOfLines={2}>
                        {it.title || '（无标题）'}
                      </Text>
                      {it.rawTime ? <Text style={styles.newsTime}>{it.rawTime}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            );
          })()}
        </Card>
          </>
        )}
      </ScrollView>

      {/* ── 底部吸底操作栏 ── */}
      <SafeAreaView
        style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 8), backgroundColor: c.surface }]}
      >
        <TouchableOpacity
          style={[
            styles.bottomBtn,
            styles.watchBarBtn,
            isIndex && { marginRight: 0 },
          ]}
          onPress={onToggleWatch}
        >
          <Icon name={watched ? Icons.star : Icons.starOutline} size={20} color={watched ? c.warning : c.text} />
          <Text style={[styles.bottomBtnText, { color: c.text }]}>{watched ? '已自选' : '加自选'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.bottomBtn, styles.thsBarBtn]}
          onPress={() => {
            openThsDetail(symbol).catch(() => undefined);
          }}
        >
          <Icon name={Icons.openExternal} size={18} color={c.text} />
          <Text style={[styles.bottomBtnText, { color: c.text }]}>同花顺</Text>
        </TouchableOpacity>
        {!isIndex && (
          <TouchableOpacity
            style={[styles.bottomBtn, styles.tradeBarBtn]}
            onPress={() => {
              const last = kline && kline.length > 0 ? kline[kline.length - 1].close : 0;
              onTrade?.(symbol, last);
            }}
          >
            <Icon name={Icons.buy} size={20} color="#fff" />
            <Text style={styles.tradeBarText}>模拟交易</Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
    </View>
  );
}

function GridItem({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={gridStyles.item}>
      <Text style={gridStyles.label}>{label}</Text>
      <Text style={gridStyles.value}>{value}</Text>
    </View>
  );
}

const gridStyles = StyleSheet.create({
  item: { width: '25%', paddingVertical: 6 },
  label: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginBottom: 2 },
  value: { color: '#fff', fontSize: 13, fontWeight: '600' },
});

function TabBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }): React.JSX.Element {
  const { colors: c } = useAppTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[tabStyles.btn, active && { backgroundColor: c.primary }]}
    >
      <Text
        style={[
          tabStyles.text,
          active ? tabStyles.textActive : tabStyles.textIdle,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const tabStyles = StyleSheet.create({
  btn: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 6, marginRight: 6, backgroundColor: 'transparent' },
  text: { fontSize: 13 },
  textActive: { color: '#fff', fontWeight: '700' },
  textIdle: { color: '#8B949E' },
});

function IndSwitch({
  label,
  active,
  onPress,
  small,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  small?: boolean;
}): React.JSX.Element {
  const { colors: c } = useAppTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={small ? indStyles.btnSmall : indStyles.btn}
    >
      <Text
        style={[
          small ? indStyles.textSmall : indStyles.text,
          { color: active ? c.warning : c.textSecondary },
          active ? indStyles.textActive : indStyles.textIdle,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const indStyles = StyleSheet.create({
  btn: { paddingHorizontal: 12, paddingVertical: 3 },
  btnSmall: { paddingHorizontal: 10, paddingVertical: 3 },
  text: { fontSize: 12 },
  textSmall: { fontSize: 11 },
  textActive: { fontWeight: '700' },
  textIdle: { fontWeight: '400' },
});

function FundItem({ label, value }: { label: string; value: string }): React.JSX.Element {
  const { colors: c } = useAppTheme();
  const styles = makeStyles(c);
  return (
    <View style={styles.fundItem}>
      <Text style={styles.fundLabel}>{label}</Text>
      <Text style={styles.fundValue}>{value}</Text>
    </View>
  );
}

function CapitalFlowPanel({
  ticks,
  northbound,
}: {
  ticks: FlowTick[];
  northbound?: { shNetBuy?: number | null; szNetBuy?: number | null };
}): React.JSX.Element {
  const { colors: c } = useAppTheme();
  const styles = makeStyles(c);
  const main = computeMainFlow(ticks);
  const tiers = computeTierFlow(ticks);
  const nb: NorthboundFlow | null = northbound ? summarizeNorthbound(northbound) : null;
  const mainColor = main.netInflow > 0 ? c.up : main.netInflow < 0 ? c.down : c.textSecondary;
  return (
    <View>
      <View style={styles.flowRow}>
        <Text style={styles.flowLabel}>主力净流入</Text>
        <Text style={[styles.flowValue, { color: mainColor }]}>{fmtFlow(main.netInflow)}</Text>
      </View>
      <View style={styles.flowRow}>
        <Text style={styles.flowLabel}>北向资金</Text>
        <Text style={[styles.flowValue, { color: nb && nb.totalNetBuy >= 0 ? c.up : c.down }]}>
          {nb ? fmtFlow(nb.totalNetBuy) : '--'}
        </Text>
      </View>
      <Text style={[styles.fundSub, { marginTop: spacing.sm }]}>大单分层</Text>
      <View style={styles.fundGrid}>
        {tierOrder().map((t) => (
          <View key={t} style={styles.fundItem}>
            <Text style={styles.fundLabel}>{TIER_LABEL[t]}</Text>
            <Text style={[styles.fundValue, { color: tiers[t].netInflow >= 0 ? c.up : c.down }]}>
              {fmtFlow(tiers[t].netInflow)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function fmtNum(v: number | null): string {
  return v == null ? '--' : v.toFixed(2);
}
function fmtBoll(ov: NonNullable<ReturnType<typeof buildIndicatorOverlay>>): string {
  const u = lastValid(ov.boll.upper);
  const l = lastValid(ov.boll.lower);
  return `${fmtNum(u)}/${fmtNum(l)}`;
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    container: { flex: 1, backgroundColor: colors.background },
    scrollContent: { paddingBottom: 72 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backBtn: { paddingRight: spacing.sm },
    titleBox: { flex: 1 },
    title: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold as any },
    codeText: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 1 },
    watchBtn: { paddingLeft: spacing.md },
    quoteCard: {
      padding: spacing.md,
      paddingBottom: spacing.sm,
    },
    quoteTop: { flexDirection: 'row', justifyContent: 'space-between' },
    quoteLeft: { flex: 1, justifyContent: 'center' },
    priceText: { color: '#fff', fontSize: 40, fontWeight: '800' },
    changeRow: { flexDirection: 'row', marginTop: 2 },
    changeText: { color: '#fff', fontSize: fontSize.md, fontWeight: '600', marginRight: spacing.md },
    bookCol: { width: 150, marginLeft: spacing.md },
    bookRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1.5 },
    bookSide: { fontSize: 10, width: 34, color: '#fff', opacity: 0.8 },
    bookPrice: { fontSize: 11, flex: 1, textAlign: 'right', fontWeight: '600', color: '#fff' },
    bookVol: { fontSize: 10, width: 56, textAlign: 'right', color: '#fff', opacity: 0.8 },
    quoteGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.25)', paddingTop: spacing.xs },
    periodRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: 2,
    },
    indSwitchRow: { flexDirection: 'row', marginLeft: 'auto', alignItems: 'center' },
    subIndRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: 4 },
    adjustRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: 6 },
    adjustLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginRight: spacing.xs, width: 32 },
    chartBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.md, marginTop: 4 },
    hint: { color: colors.textSecondary, fontSize: fontSize.sm, paddingVertical: spacing.md, textAlign: 'center' },
    error: { color: colors.down, fontSize: fontSize.sm, paddingVertical: spacing.md, textAlign: 'center' },
    indCard: { marginHorizontal: spacing.md, marginBottom: spacing.md },
    indHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
    indHeadIcon: { marginRight: spacing.xs },
    indHeadText: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold as any },
    indRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 2 },
    indItem: { color: colors.textSecondary, fontSize: fontSize.xs, marginRight: spacing.md, marginBottom: 2 },
    indVal: { color: colors.text, fontWeight: '600' },
    fundCard: { marginHorizontal: spacing.md, marginBottom: spacing.md },
    flowCard: { marginHorizontal: spacing.md, marginBottom: spacing.md },
    flowRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs },
    flowLabel: { color: colors.textSecondary, fontSize: fontSize.sm },
    flowValue: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
    newsRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.xs },
    tag: { fontSize: fontSize.xs, fontWeight: '700', width: 36, marginTop: 2 },
    newsBody: { flex: 1, marginLeft: spacing.xs },
    newsTitle: { color: colors.text, fontSize: fontSize.sm },
    newsTime: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    fundSub: { color: colors.text, fontSize: fontSize.sm, fontWeight: fontWeight.bold as any, marginBottom: spacing.xs },
    fundGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    fundItem: { width: '50%', paddingVertical: spacing.xs },
    fundLabel: { color: colors.textSecondary, fontSize: fontSize.xs },
    fundValue: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
    bottomBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: 8,
      paddingHorizontal: spacing.md,
    },
    bottomBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      borderRadius: radius.pill,
    },
    watchBarBtn: {
      flex: 1,
      marginRight: spacing.sm,
      backgroundColor: colors.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    thsBarBtn: {
      flex: 1,
      marginRight: spacing.sm,
      backgroundColor: colors.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    tradeBarBtn: { flex: 1.4, backgroundColor: colors.primary },
    bottomBtnText: { fontSize: fontSize.md, fontWeight: '600', marginLeft: 6 },
    tradeBarText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700', marginLeft: 6 },
  });
}
