/**
 * 通用卡片容器：圆角 + 表面色 + 可选边框/阴影。
 * 用法：<Card><Text>内容</Text></Card>
 */
import React from 'react';
import { View, StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme } from '@/theme/ThemeProvider';
import { spacing, radius, shadow } from '@/theme';

export function Card({
  children,
  style,
  padded = true,
  elevated = false,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  elevated?: boolean;
  onPress?: () => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const inner = (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        padded && { padding: spacing.md },
        elevated && shadow.md,
        style,
      ]}
    >
      {children}
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.9} onPress={onPress}>
        {inner}
      </TouchableOpacity>
    );
  }
  return inner;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
