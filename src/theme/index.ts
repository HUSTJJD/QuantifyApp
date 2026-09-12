/**
 * 全局主题：颜色、字号、间距。支持亮/暗模式（富途风格）。
 * 颜色通过 getColors(mode) 获取；spacing/fontSize/radius 与模式无关。
 */
export type ThemeMode = 'dark' | 'light';

/** 涨跌色方案：A股红涨 / 国际绿涨 / 色弱蓝橙 */
export type UpDownScheme = 'cn' | 'intl' | 'colorblind';

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
  /** 主色半透明底（芯片/选中态） */
  primarySoft: string;
  /** 分组卡/摘要条底色 */
  surfaceMuted: string;
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
  primarySoft: 'rgba(17,190,188,0.16)',
  surfaceMuted: 'rgba(255,255,255,0.06)',
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
  primarySoft: 'rgba(0,161,159,0.12)',
  surfaceMuted: '#F2F4F3',
};

export function getColors(mode: ThemeMode, scheme: UpDownScheme = 'cn'): ColorScheme {
  const base = mode === 'light' ? LightColors : DarkColors;
  if (scheme === 'cn') return base;
  if (scheme === 'intl') {
    return { ...base, up: base.down, down: base.up };
  }
  // colorblind: 蓝涨橙跌（亮暗均适配）
  if (mode === 'light') {
    return { ...base, up: '#2563EB', down: '#EA580C' };
  }
  return { ...base, up: '#60A5FA', down: '#FB923C' };
}

/** 默认（向后兼容）导出暗色，避免既有 import { colors } 报错。 */
export const colors = DarkColors;

export const spacing = {
  /** 2px — 发丝间距、图标与标签 */
  xxs: 2,
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

/** 动效时长（ms），对齐 Opptrix MOTION */
export const duration = {
  fast: 120,
  base: 200,
  slow: 320,
} as const;

/** 语义布局别名：组件消费这些，避免硬编码 */
export const layout = {
  gapInline: spacing.xs,
  gapStack: spacing.sm,
  gapCard: spacing.md,
  paddingCard: spacing.lg,
  radiusControl: radius.sm,
  radiusCard: radius.md,
  radiusPanel: radius.lg,
  radiusPill: radius.pill,
  /** 分组芯片高度（对齐 Opptrix watchlist chips） */
  chipHeight: 28,
  /** 行内触控最小高度 */
  rowMinHeight: 48,
} as const;

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

export const theme = { colors, spacing, fontSize, fontWeight, radius, duration, layout, shadow, zIndex, iconSize };
export type Theme = typeof theme;

