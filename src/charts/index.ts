/**
 * 统一图表层入口。
 *
 * - K 线：KLineChart（react-native-kline-chart / ECharts+Skia / 降级）
 * - 折线：LineGraphView（react-native-graph / SVG 回退）
 * - 纯逻辑：指标、格式化、缩放历史、引擎探测（移植自 kline-charts-react）
 */

export {
  isSkiaAvailable,
  isGraphAvailable,
  isKlineChartAvailable,
  isEchartsSkiaAvailable,
  isWorkletsHealthy,
  probeChartEngines,
  getProbedEngines,
  resetChartEngineCache,
} from './availability';

export * from './formatters';
export * from './indicators';
export { useZoomHistory } from './zoomHistory';
export type { ZoomState } from './zoomHistory';

export { KLineChart } from '@/components/KLineChart';
export type {
  KLineChartProps,
  KLineEngine,
  MainIndicator,
  SubIndicator,
} from '@/components/KLineChart';
export { LineGraphView } from '@/components/LineGraphView';
export type { LineGraphViewProps } from '@/components/LineGraphView';
