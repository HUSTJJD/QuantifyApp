/**
 * KLineChart —— 多引擎 K 线封装。
 *
 * 引擎优先级：
 * 1. react-native-kline-chart（Skia 原生手势，60fps，轻量主图）
 * 2. @wuba/react-native-echarts + Skia（完整副图指标 / dataZoom）
 * 3. 占位降级（引擎未就绪 / Jest）
 *
 * 指标与格式化来自 src/charts（移植自 kline-charts-react 纯逻辑）。
 */
import React, {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import type { Candle, KlinePeriod } from '@/data/api';
import { useAppTheme } from '@/theme/ThemeProvider';
import { getChartTheme } from '@/chart/theme';
import { buildKlineOption, type SubPaneId } from '@/chart/buildKlineOption';
import { getMAPeriods } from '@/chart/indicatorMeta';
import {
  isEchartsSkiaAvailable,
  isKlineChartAvailable,
  probeChartEngines,
} from '@/charts/availability';
import { spacing, fontSize, radius } from '@/theme';
import { logger } from '@/utils/logger';

export type MainIndicator = 'none' | 'ma' | 'boll';
export type SubIndicator = 'none' | 'macd' | 'kdj' | 'rsi' | 'wr' | 'volume';

export type KLineEngine = 'kline-chart' | 'echarts-skia' | 'fallback';

class KLineBoundary extends Component<
  { children: ReactNode; height: number },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    logger.error('KLineChart', `K线渲染异常降级: ${String(error)}`);
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={[styles.empty, { height: this.props.height }]}>
          <Text style={styles.hint}>K线图暂时无法显示</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export interface KLineChartProps {
  data: Candle[];
  period: KlinePeriod;
  height?: number;
  mainIndicator?: MainIndicator;
  subIndicator?: SubIndicator;
  pricePrecision?: number;
  isDark?: boolean;
  maPeriods?: number[];
  onLoadMore?: () => Promise<boolean>;
  /** 强制指定引擎；默认自动选择 */
  engine?: KLineEngine | 'auto';
}

function pickEngine(preferred: KLineEngine | 'auto', needSubPane: boolean): KLineEngine {
  if (preferred === 'fallback') return 'fallback';
  if (preferred === 'kline-chart') {
    return isKlineChartAvailable() ? 'kline-chart' : 'fallback';
  }
  if (preferred === 'echarts-skia') {
    return isEchartsSkiaAvailable()
      ? 'echarts-skia'
      : isKlineChartAvailable()
        ? 'kline-chart'
        : 'fallback';
  }
  // auto：有副图（volume/MACD/…）必须走 ECharts；纯主图优先轻量 kline-chart
  if (needSubPane) {
    if (isEchartsSkiaAvailable()) return 'echarts-skia';
    if (isKlineChartAvailable()) return 'kline-chart';
    return 'fallback';
  }
  if (isKlineChartAvailable()) return 'kline-chart';
  if (isEchartsSkiaAvailable()) return 'echarts-skia';
  return 'fallback';
}

function toNativeCandles(data: Candle[]) {
  return data.map((c) => ({
    time: typeof c.datetime === 'number' ? c.datetime : new Date(c.datetime).getTime(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

export const KLineChart = ({
  data,
  period: _period,
  height = 320,
  mainIndicator = 'ma',
  subIndicator = 'volume',
  isDark,
  maPeriods,
  engine: engineProp = 'auto',
}: KLineChartProps): React.JSX.Element => {
  const { mode } = useAppTheme();
  const theme = getChartTheme(isDark === false ? 'light' : isDark === true ? 'dark' : mode);
  const { width: winW } = useWindowDimensions();
  const [boxW, setBoxW] = useState(0);
  const width = Math.max(280, Math.floor(boxW || winW - spacing.lg * 2));
  const chartRef = useRef<any>(null);
  const echartsRef = useRef<any>(null);

  const needSubPane = subIndicator !== 'none' && subIndicator !== undefined;
  const [engineReady, setEngineReady] = useState(false);
  const [engine, setEngine] = useState<KLineEngine>('fallback');
  /** SkiaChart 已挂载（ECharts 宿主就绪） */
  const [skiaHostReady, setSkiaHostReady] = useState(false);

  // 异步探测：有副图时必须探测 echarts
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await probeChartEngines({ includeEcharts: needSubPane });
      if (cancelled) return;
      // 副图需要 echarts 但首次未探到时再探一次
      if (needSubPane && !isEchartsSkiaAvailable()) {
        await probeChartEngines({ includeEcharts: true });
      }
      if (cancelled) return;
      setSkiaHostReady(false);
      setEngine(pickEngine(engineProp, needSubPane));
      setEngineReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [engineProp, needSubPane]);

  const option = useMemo(() => {
    if (engine !== 'echarts-skia') return null;
    if (!data || data.length === 0) return null;
    return buildKlineOption({
      data,
      theme,
      height,
      showMA: mainIndicator === 'ma' || mainIndicator === 'boll',
      showBOLL: mainIndicator === 'boll',
      maPeriods: getMAPeriods(maPeriods),
      sub: (subIndicator === 'none' ? 'none' : (subIndicator as SubPaneId)) ?? 'volume',
    });
  }, [data, theme, height, mainIndicator, subIndicator, maPeriods, engine]);

  const nativeCandles = useMemo(
    () => (engine === 'kline-chart' ? toNativeCandles(data ?? []) : null),
    [engine, data],
  );

  // ECharts/Skia 引擎初始化（等 SkiaChart 挂好再 init）
  useEffect(() => {
    if (engine !== 'echarts-skia' || !option || !skiaHostReady || !chartRef.current) return;
    let disposed = false;
    (async () => {
      try {
        const echarts = await import('echarts/core');
        const { CandlestickChart, LineChart, BarChart } = await import('echarts/charts');
        const {
          GridComponent,
          TooltipComponent,
          DataZoomComponent,
          AxisPointerComponent,
        } = await import('echarts/components');
        const { SkiaRenderer } = await import('@wuba/react-native-echarts/skiaChart');
        echarts.use([
          CandlestickChart,
          LineChart,
          BarChart,
          GridComponent,
          TooltipComponent,
          DataZoomComponent,
          AxisPointerComponent,
          SkiaRenderer,
        ]);
        if (disposed || !chartRef.current) return;
        echartsRef.current?.dispose?.();
        const chart = echarts.init(chartRef.current, undefined, {
          // @ts-expect-error skia renderer
          renderer: 'skia',
          width,
          height,
        });
        chart.setOption(option);
        echartsRef.current = chart;
      } catch (e) {
        logger.error('KLineChart', `ECharts init 失败: ${String(e)}`);
      }
    })();
    return () => {
      disposed = true;
      echartsRef.current?.dispose?.();
      echartsRef.current = null;
    };
  }, [engine, option, width, height, skiaHostReady]);

  if (!data || data.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.hint}>该周期暂无数据</Text>
      </View>
    );
  }

  if (engine === 'fallback') {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.hint}>
          {engineReady ? '图表引擎未就绪' : '图表加载中…'}
        </Text>
        {engineReady ? (
          <Text style={styles.subHint}>原生 Skia/worklets 不可用，已降级</Text>
        ) : null}
      </View>
    );
  }

  return (
    <KLineBoundary height={height}>
      <View
        style={[styles.wrap, { height, width }]}
        onLayout={(e) => {
          const w = Math.floor(e.nativeEvent.layout.width);
          if (w > 0 && Math.abs(w - boxW) > 1) setBoxW(w);
        }}
      >
        {engine === 'kline-chart' ? (
          <NativeKlinePane
            candles={nativeCandles!}
            width={width}
            height={height}
            theme={theme}
            showMA={mainIndicator !== 'none'}
            maPeriods={getMAPeriods(maPeriods)}
          />
        ) : (
          <EchartsSkiaPane
            chartRef={chartRef}
            width={width}
            height={height}
            onReady={() => setSkiaHostReady(true)}
          />
        )}
      </View>
    </KLineBoundary>
  );
};

/** ECharts Skia 宿主：必须挂 SkiaChart，普通 View 会 setZrenderId 失败 */
function EchartsSkiaPane({
  chartRef,
  width,
  height,
  onReady,
}: {
  chartRef: React.MutableRefObject<any>;
  width: number;
  height: number;
  onReady?: () => void;
}): React.JSX.Element {
  const [SkiaChart, setSkiaChart] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const readyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await import('@wuba/react-native-echarts/skiaChart');
        // 该子路径是 default export
        const comp = (m as any).default ?? (m as any).SkiaChart;
        if (!cancelled) setSkiaChart(() => comp);
      } catch (e) {
        logger.error('KLineChart', `SkiaChart 加载失败: ${String(e)}`);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (SkiaChart && !readyRef.current && chartRef.current) {
      readyRef.current = true;
      onReady?.();
    }
  }, [SkiaChart, chartRef, onReady]);

  if (failed || !SkiaChart) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.hint}>{failed ? 'ECharts 引擎加载失败' : '加载中…'}</Text>
      </View>
    );
  }
  return <SkiaChart ref={chartRef} style={{ width, height }} />;
}

/** react-native-kline-chart 内联封装（懒加载，避免顶层 require 炸树） */
function NativeKlinePane({
  candles,
  width,
  height,
  theme,
  showMA,
  maPeriods,
}: {
  candles: Array<{ time: number; open: number; high: number; low: number; close: number }>;
  width: number;
  height: number;
  theme: ReturnType<typeof getChartTheme>;
  showMA: boolean;
  maPeriods: number[];
}): React.JSX.Element {
  const [mod, setMod] = useState<any>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await import('react-native-kline-chart');
        if (!cancelled) setMod(m);
      } catch (e) {
        logger.error('KLineChart', `kline-chart 加载失败: ${String(e)}`);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed || !mod) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.hint}>{failed ? 'K线引擎加载失败' : '加载中…'}</Text>
      </View>
    );
  }

  const { KlineChart } = mod;
  return (
    <KlineChart
      data={candles}
      width={width}
      height={height}
      bullishColor={theme.up}
      bearishColor={theme.down}
      backgroundColor={theme.background}
      gridColor={theme.gridLine}
      textColor={theme.textSecondary}
      crosshairColor={theme.crosshair}
      showMA={showMA}
      maPeriods={maPeriods.slice(0, 4)}
      maColors={theme.maColors}
    />
  );
}

export interface KLineChartHandle {
  resetLoadMoreEnd: () => void;
  setLoadMoreEnd: () => void;
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', borderRadius: radius.md, alignSelf: 'stretch' },
  empty: { alignItems: 'center', justifyContent: 'center' },
  hint: {
    color: '#888',
    fontSize: fontSize.sm,
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
  subHint: {
    color: '#666',
    fontSize: fontSize.xs,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
});

export default KLineChart;
