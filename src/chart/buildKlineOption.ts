/**
 * ECharts K 线 Option 构建（借鉴 kline-charts-react optionBuilder，适配 RN）。
 * 面板：主图(蜡烛+MA[+BOLL]) + 成交量 + 副图(MACD/KDJ/RSI/WR 选一)。
 */
import type { Candle } from '@/data/api';
import type { ChartTheme } from './theme';
import { calcMA, calcBOLL, calcMACD, calcKDJ, calcRSI, calcWR } from '@/components/kline/indicators';

export type SubPaneId = 'volume' | 'macd' | 'kdj' | 'rsi' | 'wr' | 'none';

export interface BuildKlineOptionParams {
  data: Candle[];
  theme: ChartTheme;
  height: number;
  showMA?: boolean;
  maPeriods?: number[];
  showBOLL?: boolean;
  sub?: SubPaneId;
  /** 可见根数窗口，默认最近 120 */
  visibleCount?: number;
}

function fmtTime(dt: number | string): string {
  const t = typeof dt === 'number' ? dt : new Date(dt).getTime();
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function volLabel(v: number): string {
  if (!Number.isFinite(v)) return '--';
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万`;
  return String(Math.round(v));
}

function toRaw(data: Candle[]) {
  return data.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    vol: c.volume ?? 0,
  }));
}

export function buildKlineOption(params: BuildKlineOptionParams): Record<string, unknown> {
  const {
    data,
    theme,
    height,
    showMA = true,
    maPeriods = [5, 10, 20],
    showBOLL = false,
    sub = 'volume',
    visibleCount = 120,
  } = params;

  if (!data || data.length === 0) {
    return {
      title: {
        text: '暂无数据',
        left: 'center',
        top: 'center',
        textStyle: { color: theme.textSecondary, fontSize: 13 },
      },
    };
  }

  const raw = toRaw(data);
  const dates = data.map((c) => fmtTime(c.datetime));
  const ohlc = raw.map((c) => [c.open, c.close, c.low, c.high]);
  const vols = raw.map((c) => c.vol);

  // 布局高度（借鉴 kline-charts-react：主图偏大，副图紧凑）
  const top = 8;
  const bottom = 28;
  const gap = 8;
  const hasSub = sub !== 'none';
  const available = Math.max(120, height - top - bottom - (hasSub ? gap : 0));
  const mainH = hasSub ? Math.floor(available * 0.72) : available;
  const subH = hasSub ? available - mainH : 0;
  const subTop = top + mainH + gap;

  const maList = showMA ? calcMA(raw, maPeriods) : [];
  const bollList = showBOLL ? calcBOLL(raw, 20, 2) : [];
  const macdList = sub === 'macd' ? calcMACD(raw) : [];
  const kdjList = sub === 'kdj' ? calcKDJ(raw) : [];
  const rsiList = sub === 'rsi' ? calcRSI(raw, [6, 12, 24]) : [];
  const wrList = sub === 'wr' ? calcWR(raw, [6, 10]) : [];

  const maColors = theme.maColors;
  const maSeries = showMA
    ? maPeriods.map((p, i) => ({
        name: `MA${p}`,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: maList.map((row) => row[i]?.value ?? null),
        showSymbol: false,
        lineStyle: { width: 1, color: maColors[i % maColors.length] },
        emphasis: { disabled: true },
      }))
    : [];

  const bollSeries = showBOLL
    ? [
        {
          name: 'BOLL',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: bollList.map((b) => b.bollUp),
          showSymbol: false,
          lineStyle: { width: 1, color: theme.bollColors[0] },
        },
        {
          name: 'BOLL',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: bollList.map((b) => b.bollMb),
          showSymbol: false,
          lineStyle: { width: 1, color: theme.bollColors[1] },
        },
        {
          name: 'BOLL',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: bollList.map((b) => b.bollDn),
          showSymbol: false,
          lineStyle: { width: 1, color: theme.bollColors[2] },
        },
      ]
    : [];

  const volumeSeries = sub === 'volume'
    ? [
        {
          name: '成交量',
          type: 'bar',
          xAxisIndex: hasSub ? 1 : 0,
          yAxisIndex: hasSub ? 1 : 0,
          data: vols.map((v, i) => ({
            value: v,
            itemStyle: {
              color: raw[i]!.close >= raw[i]!.open ? theme.up + '99' : theme.down + '99',
            },
          })),
        },
      ]
    : [];

  const macdSeries =
    sub === 'macd'
      ? [
          {
            name: 'DIF',
            type: 'line',
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: macdList.map((m) => m.macdDif),
            showSymbol: false,
            lineStyle: { width: 1, color: theme.maColors[0] },
          },
          {
            name: 'DEA',
            type: 'line',
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: macdList.map((m) => m.macdDea),
            showSymbol: false,
            lineStyle: { width: 1, color: theme.maColors[1] },
          },
          {
            name: 'MACD',
            type: 'bar',
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: macdList.map((m) => ({
              value: m.macdValue,
              itemStyle: { color: m.macdValue >= 0 ? theme.up : theme.down },
            })),
          },
        ]
      : [];

  const kdjSeries =
    sub === 'kdj'
      ? (['kdjK', 'kdjD', 'kdjJ'] as const).map((key, i) => ({
          name: key.toUpperCase(),
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: kdjList.map((k) => k[key]),
          showSymbol: false,
          lineStyle: { width: 1, color: theme.maColors[i % theme.maColors.length] },
        }))
      : [];

  const rsiSeries =
    sub === 'rsi'
      ? [
          {
            name: 'RSI',
            type: 'line',
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: rsiList.map((row) => row[0]?.value ?? null),
            showSymbol: false,
            lineStyle: { width: 1, color: theme.active },
          },
        ]
      : [];

  const wrSeries =
    sub === 'wr'
      ? [
          {
            name: 'WR',
            type: 'line',
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: wrList.map((row) => row[0]?.value ?? null),
            showSymbol: false,
            lineStyle: { width: 1, color: theme.active },
          },
        ]
      : [];

  const start = Math.max(0, data.length - visibleCount);

  return {
    animation: false,
    backgroundColor: 'transparent',
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
        crossStyle: { color: theme.crosshair },
        lineStyle: { color: theme.crosshair, type: 'dashed' },
      },
      backgroundColor: theme.background,
      borderColor: theme.gridLine,
      textStyle: { color: theme.text, fontSize: 11 },
    },
    grid: [
      { left: 8, right: 48, top, height: mainH },
      ...(hasSub ? [{ left: 8, right: 48, top: subTop, height: subH }] : []),
    ],
    xAxis: [
      {
        type: 'category',
        data: dates,
        gridIndex: 0,
        boundaryGap: true,
        axisLine: { lineStyle: { color: theme.gridLine } },
        axisTick: { show: false },
        axisLabel: { show: !hasSub, color: theme.textSecondary, fontSize: 10 },
        splitLine: { show: false },
      },
      ...(hasSub
        ? [
            {
              type: 'category',
              data: dates,
              gridIndex: 1,
              boundaryGap: true,
              axisLine: { lineStyle: { color: theme.gridLine } },
              axisTick: { show: false },
              axisLabel: { color: theme.textSecondary, fontSize: 10 },
              splitLine: { show: false },
            },
          ]
        : []),
    ],
    yAxis: [
      {
        type: 'value',
        gridIndex: 0,
        position: 'right',
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: theme.textSecondary, fontSize: 10 },
        splitLine: { lineStyle: { color: theme.gridLine, type: 'dashed' } },
      },
      ...(hasSub
        ? [
            {
              type: 'value',
              gridIndex: 1,
              position: 'right',
              scale: true,
              axisLine: { show: false },
              axisTick: { show: false },
              axisLabel: {
                color: theme.textSecondary,
                fontSize: 10,
                formatter: sub === 'volume' ? (v: number) => volLabel(v) : undefined,
              },
              splitLine: { lineStyle: { color: theme.gridLine, type: 'dashed' } },
            },
          ]
        : []),
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: hasSub ? [0, 1] : [0], start, end: 100, minValueSpan: 10 },
    ],
    series: [
      {
        name: 'K线',
        type: 'candlestick',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ohlc,
        itemStyle: {
          color: theme.up,
          color0: theme.down,
          borderColor: theme.up,
          borderColor0: theme.down,
        },
      },
      ...maSeries,
      ...bollSeries,
      ...volumeSeries,
      ...macdSeries,
      ...kdjSeries,
      ...rsiSeries,
      ...wrSeries,
    ],
  };
}
