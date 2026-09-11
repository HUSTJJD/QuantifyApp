/**
 * 图表引擎可用性探测。
 *
 * Metro 要求 require() 参数为字符串字面量。
 * worklets / echarts 在模块加载期可能抛错并弹红屏，因此：
 * - 不在 render 路径同步 require 原生/重依赖
 * - 仅在 effect 里异步 import；默认只探轻量 kline-chart + graph
 * - echarts 链路（zrender/tslib）较脆，仅在确实需要副图时再探
 */

export type ChartEngineId = 'kline-chart' | 'echarts-skia' | 'fallback';

let probed = false;
let klineChartOk = false;
let echartsSkiaOk = false;
let graphOk = false;

function isTestEnv(): boolean {
  return typeof jest !== 'undefined' || process.env.NODE_ENV === 'test';
}

/** 异步探测图表引擎。默认不加载 echarts（避免 zrender/tslib 红屏）。 */
export async function probeChartEngines(
  options: { includeEcharts?: boolean } = {},
): Promise<{
  klineChart: boolean;
  echartsSkia: boolean;
  graph: boolean;
}> {
  if (isTestEnv()) {
    return { klineChart: false, echartsSkia: false, graph: false };
  }
  if (!probed) {
    probed = true;
    try {
      await import('react-native-kline-chart');
      klineChartOk = true;
    } catch {
      klineChartOk = false;
    }
    try {
      await import('react-native-graph');
      graphOk = true;
    } catch {
      graphOk = false;
    }
    if (options.includeEcharts) {
      try {
        await import('@wuba/react-native-echarts/skiaChart');
        await import('echarts/core');
        echartsSkiaOk = true;
      } catch {
        echartsSkiaOk = false;
      }
    }
  } else if (options.includeEcharts && !echartsSkiaOk) {
    try {
      await import('@wuba/react-native-echarts/skiaChart');
      await import('echarts/core');
      echartsSkiaOk = true;
    } catch {
      echartsSkiaOk = false;
    }
  }
  return { klineChart: klineChartOk, echartsSkia: echartsSkiaOk, graph: graphOk };
}

export function getProbedEngines() {
  return {
    klineChart: klineChartOk,
    echartsSkia: echartsSkiaOk,
    graph: graphOk,
    probed,
  };
}

/** 同步读缓存结果（未探测完时为 false） */
export function isKlineChartAvailable(): boolean {
  return klineChartOk;
}
export function isEchartsSkiaAvailable(): boolean {
  return echartsSkiaOk;
}
export function isGraphAvailable(): boolean {
  return graphOk;
}
export function isSkiaAvailable(): boolean {
  return klineChartOk || echartsSkiaOk || graphOk;
}
export function isWorkletsHealthy(): boolean {
  return isSkiaAvailable();
}

export function resetChartEngineCache(): void {
  probed = false;
  klineChartOk = false;
  echartsSkiaOk = false;
  graphOk = false;
}