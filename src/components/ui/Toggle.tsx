/**
 * 开关（可自定义开态主题色）。用于策略启用/自动交易等配置行。
 */
import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { useAppTheme } from '@/theme/ThemeProvider';

export function Toggle({
  on,
  accent,
  disabled,
  onChange,
}: {
  on: boolean;
  /** 开态轨道色，默认主题 primary */
  accent?: string;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={disabled}
      onPress={() => onChange?.(!on)}
      style={[
        styles.track,
        { backgroundColor: on ? accent ?? colors.primary : colors.border, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <View style={[styles.knob, { backgroundColor: '#fff' }, on && styles.knobOn]} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  track: { width: 46, height: 27, borderRadius: 13.5, justifyContent: 'center', paddingHorizontal: 2 },
  knob: { width: 23, height: 23, borderRadius: 11.5 },
  knobOn: { alignSelf: 'flex-end' },
});
