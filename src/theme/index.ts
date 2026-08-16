/**
 * 全局主题：颜色、字号、间距。支持亮/暗模式（富途风格）。
 * 颜色通过 getColors(mode) 获取；spacing/fontSize/radius 与模式无关。
 */
export type ThemeMode = 'dark' | 'light';

export interface ColorScheme {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textSecondary: string;
  primary: string;
  up: string;
  down: string;
  flat: string;
}

export const DarkColors: ColorScheme = {
  background: '#0E1116',
  surface: '#161B22',
  surfaceAlt: '#1C2230',
  border: '#2A313C',
  text: '#E6EDF3',
  textSecondary: '#8B949E',
  primary: '#E5484D',
  up: '#F5465C',
  down: '#2DCB73',
  flat: '#8B949E',
};

export const LightColors: ColorScheme = {
  background: '#F5F6F8',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF1F5',
  border: '#E3E6EB',
  text: '#1A1F29',
  textSecondary: '#6B7280',
  primary: '#E5484D',
  up: '#E5484D',
  down: '#16A34A',
  flat: '#6B7280',
};

export function getColors(mode: ThemeMode): ColorScheme {
  return mode === 'light' ? LightColors : DarkColors;
}

/** 默认（向后兼容）导出暗色，避免既有 import { colors } 报错。 */
export const colors = DarkColors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  title: 28,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
};

export const theme = { colors, spacing, fontSize, radius };
export type Theme = typeof theme;

