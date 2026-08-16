/**
 * Icon —— 统一图标组件（基于 react-native-vector-icons/MaterialCommunityIcons）。
 *
 * 为什么需要封装：
 *  - 语义色名：页面可直接写 color="primary" / "textSecondary" / "warning" 等，
 *    由本组件从 theme 解析为真实颜色（vector-icons 本身不认语义色名）；
 *  - 尺寸语义：size 支持 "sm"|"md"|"lg"|"xl" 或数字（px）；
 *  - 历史兼容：早期页面误写 size={2}（2px 几乎不可见），此处兜底为默认尺寸，
 *    避免图标"看不见"；后续新代码请用语义尺寸或真实 px。
 *
 * 图标名统一来自 @/assets/icons（Icons 常量），唯一来源。
 */
import React from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import MCIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '@/theme/ThemeProvider';
import type { ColorScheme } from '@/theme';
import type { IconName } from '@/assets/icons';

export type IconSize = number | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_MAP: Record<Exclude<IconSize, number>, number> = {
  sm: 14,
  md: 18,
  lg: 24,
  xl: 32,
};
const DEFAULT_SIZE = 18;

/** 把 size 解析为 px：数字透传（<=4 视为历史误写，兜底默认）；语义名查表 */
function resolveSize(size?: IconSize): number {
  if (typeof size === 'number') return size > 4 ? size : DEFAULT_SIZE;
  return SIZE_MAP[size ?? 'md'] ?? DEFAULT_SIZE;
}

export function Icon({
  name,
  size,
  color,
  style,
  ...rest
}: {
  name: IconName | string;
  size?: IconSize;
  /** 语义色名（如 primary/textSecondary/warning）或真实颜色值 */
  color?: string;
  style?: StyleProp<TextStyle>;
} & Omit<Partial<React.ComponentProps<typeof MCIcon>>, 'name' | 'size' | 'color'>): React.JSX.Element {
  const { colors } = useAppTheme();
  // 语义色名 -> theme 颜色；非色名（真实颜色值）原样透传
  const resolved =
    typeof color === 'string' && color in colors ? colors[color as keyof ColorScheme] : color;
  return <MCIcon name={name as string} size={resolveSize(size)} color={resolved} style={style} {...rest} />;
}
