/**
 * 图表主题（借鉴 kline-charts-react ThemeConfig，映射到本 App 色板）。
 */
import { colors as appColors, getColors, type ThemeMode } from '@/theme';

export interface ChartTheme {
  background: string;
  text: string;
  textSecondary: string;
  gridLine: string;
  up: string;
  down: string;
  maColors: string[];
  crosshair: string;
  active: string;
  bollColors: [string, string, string];
  kcColors: [string, string, string];
}

export const lightChartTheme: ChartTheme = {
  background: '#ffffff',
  text: '#1A1F29',
  textSecondary: '#8B93A1',
  gridLine: '#E8EAED',
  up: '#F5222D',
  down: '#52C41A',
  maColors: ['#F5A623', '#1890FF', '#722ED1', '#13C2C2', '#EB2F96', '#FAAD14', '#A0D911'],
  crosshair: '#8B93A1',
  active: '#1890FF',
  bollColors: ['#FAAD14', '#1890FF', '#722ED1'],
  kcColors: ['#52C41A', '#13C2C2', '#EB2F96'],
};

export const darkChartTheme: ChartTheme = {
  background: '#12141A',
  text: '#E8EAED',
  textSecondary: '#6B7280',
  gridLine: '#2A2F3A',
  up: '#F5222D',
  down: '#52C41A',
  maColors: ['#F5A623', '#1890FF', '#722ED1', '#13C2C2', '#EB2F96', '#FAAD14', '#A0D911'],
  crosshair: '#6B7280',
  active: '#1890FF',
  bollColors: ['#FAAD14', '#1890FF', '#722ED1'],
  kcColors: ['#52C41A', '#13C2C2', '#EB2F96'],
};

/** 由 App 主题模式取图表主题（涨跌色跟 App 语义色） */
export function getChartTheme(mode: ThemeMode): ChartTheme {
  const base = mode === 'dark' ? darkChartTheme : lightChartTheme;
  const app = getColors(mode);
  return {
    ...base,
    background: app.background,
    text: app.text,
    textSecondary: app.textSecondary,
    gridLine: app.border,
    up: app.up,
    down: app.down,
    active: app.primary,
  };
}

/** 默认：跟随全局 colors（ThemeProvider 默认 dark） */
export function defaultChartTheme(): ChartTheme {
  return {
    ...darkChartTheme,
    background: appColors.background,
    text: appColors.text,
    textSecondary: appColors.textSecondary,
    gridLine: appColors.border,
    up: appColors.up,
    down: appColors.down,
  };
}
