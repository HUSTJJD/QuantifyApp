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
  /** 涨（A股习惯：红） */
  up: string;
  /** 跌（A股习惯：绿） */
  down: string;
  /** 平 */
  flat: string;
  /** 语义状态色 */
  success: string;
  warning: string;
  info: string;
  link: string;
}

export const DarkColors: ColorScheme = {
  // Ghostfolio 暗色：中性深灰 + 青绿主色（品牌）
  background: '#191919',
  surface: '#242424',
  surfaceAlt: '#2E2E2E',
  border: 'rgba(255,255,255,0.08)',
  text: '#F5F5F5',
  textSecondary: 'rgba(255,255,255,0.55)',
  primary: '#11BEBC',
  up: '#F5465C',
  down: '#2DCB73',
  flat: 'rgba(255,255,255,0.38)',
  success: '#2DCB73',
  warning: '#F5A623',
  info: '#66B0FB',
  link: '#66B0FB',
};

export const LightColors: ColorScheme = {
  // Ghostfolio 浅色：#FAFAFA 底 + 纯白卡片
  background: '#FAFAFA',
  surface: '#FFFFFF',
  surfaceAlt: '#F2F4F3',
  border: 'rgba(0,0,0,0.08)',
  text: 'rgba(0,0,0,0.87)',
  textSecondary: 'rgba(0,0,0,0.54)',
  primary: '#00A19F',
  up: '#E5484D',
  down: '#16A34A',
  flat: 'rgba(0,0,0,0.38)',
  success: '#16A34A',
  warning: '#D97706',
  info: '#2563EB',
  link: '#00A19F',
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
  xxl: 32,
};

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  title: 28,
  display: 34,
};

/** 字重层级（与系统字体栈配合） */
export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
};

/** 阴影/层级（按模式返回，暗色更弱、亮色更柔） */
export const shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
};

/** 语义层级 */
export const zIndex = {
  base: 0,
  sticky: 10,
  overlay: 100,
  modal: 1000,
};

/** 图标尺寸层级 */
export const iconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

export const theme = { colors, spacing, fontSize, fontWeight, radius, shadow, zIndex, iconSize };
export type Theme = typeof theme;

