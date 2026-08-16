/**
 * SearchBar —— 通用搜索栏组件。
 *
 * 可用于首页、搜索页顶部等多处。支持：
 *  - 受控 value / onChangeText
 *  - 占位符自定义
 *  - 清除按钮（有内容时显示）
 *  - 聚焦/失焦回调
 */
import React from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Icon } from './Icon';
import { Icons } from '@/assets/icons';
import { spacing, fontSize, radius } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  onClear?: () => void;
  autoFocus?: boolean;
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = '搜索股票、指数、基金',
  onFocus,
  onBlur,
  onClear,
  autoFocus = false,
}: SearchBarProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);

  return (
    <View style={styles.container}>
      <Icon name={Icons.search} size={2} color="textSecondary" style={styles.icon} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        onFocus={onFocus}
        onBlur={onBlur}
        autoFocus={autoFocus}
        returnKeyType="search"
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={onClear} hitSlop={8}>
          <Icon name={Icons.close} size={2} color="textSecondary" />
        </TouchableOpacity>
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      height: 40,
    },
    icon: { marginRight: spacing.sm },
    input: {
      flex: 1,
      color: colors.text,
      fontSize: fontSize.md,
      padding: 0,
    },
  });
}
