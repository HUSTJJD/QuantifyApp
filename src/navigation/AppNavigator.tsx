/**
 * 轻量导航容器（地基阶段不引入 react-navigation，用本地栈管理）。
 *
 * 设计要点：
 *  - 用 stack 数组保存导航历史，栈底固定为 main（主业），保证任何页面都能返回；
 *  - navigate(route) 压栈，back() 出栈；detail 从哪进就从哪回（保留上下文）；
 *  - 底部全局导航栏（主页/自选股/资产/设置），点击切换：已在该 tab 不处理，
 *    已在栈中则弹出到它，否则压栈；进入个股详情时隐藏底部栏；
 *  - 后续可平滑替换为 @react-navigation/native 的 Stack + BottomTab，结构不变。
 */
import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { BottomNavigation, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MainScreen } from '@/features/home/MainScreen';
import { StockDetailScreen } from '@/features/stock/StockDetailScreen';
import { WatchlistScreen } from '@/features/watchlist/WatchlistScreen';
import { AssetScreen } from '@/features/asset/AssetScreen';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { SignalsScreen } from '@/features/quant/SignalsScreen';
import { DebugLogScreen } from '@/features/debug/DebugLogScreen';
import { ApiStatsScreen } from '@/features/debug/ApiStatsScreen';
import { SimulationScreen } from '@/features/simulation/SimulationScreen';
import { TradeScreen } from '@/features/simulation/TradeScreen';
import type { Symbol } from '@/api';
import { useAppTheme } from '@/theme/ThemeProvider';

type RouteName = 'main' | 'watchlist' | 'asset' | 'signals' | 'sim' | 'detail' | 'trade' | 'settings' | 'debuglog';
type Route =
  | { name: 'main' }
  | { name: 'watchlist' }
  | { name: 'asset' }
  | { name: 'signals' }
  | { name: 'sim' }
  | { name: 'detail'; symbol: Symbol }
  | { name: 'trade'; symbol: Symbol; lastPrice: number }
  | { name: 'settings' }
  | { name: 'debuglog' }
  | { name: 'apistats' };

const INITIAL_STACK: Route[] = [{ name: 'main' }];

/** 底部导航栏的 tab 定义（仅顶层页面） */
const TABS: { key: Exclude<RouteName, 'detail' | 'trade'>; title: string; icon: string }[] = [
  { key: 'main', title: '主页', icon: 'home-variant' },
  { key: 'signals', title: '信号', icon: 'bell-ring' },
  { key: 'sim', title: '模拟盘', icon: 'account-cash' },
  { key: 'watchlist', title: '自选股', icon: 'format-list-bulleted' },
  { key: 'asset', title: '资产', icon: 'wallet' },
  { key: 'settings', title: '设置', icon: 'cog' },
];

export function AppNavigator(): React.JSX.Element {
  const theme = useTheme();
  const { colors } = useAppTheme();
  const [stack, setStack] = useState<Route[]>(INITIAL_STACK);

  const navigate = useCallback((route: Route) => {
    setStack((prev) => [...prev, route]);
  }, []);

  const back = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  // 当前栈顶
  const current = stack[stack.length - 1];

  // 点击底部 tab：已在则忽略；已在栈中则弹出到它；否则压栈
  const goTab = useCallback(
    (key: RouteName) => {
      if (current.name === key) return;
      const idx = stack.findIndex((r) => r.name === key);
      if (idx >= 0) {
        setStack((prev) => prev.slice(0, idx + 1));
      } else {
        navigate({ name: key } as Route);
      }
    },
    [current.name, stack, navigate],
  );

  const tabIndex = TABS.findIndex((t) => t.key === current.name);
  const showBar = tabIndex >= 0; // 个股详情(detail) 隐藏底部栏

  const navState = useMemo(
    () => ({
      index: tabIndex < 0 ? 0 : tabIndex,
      routes: TABS.map((t) => ({ key: t.key, title: t.title, focusedIcon: t.icon })),
    }),
    [tabIndex],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        {current.name === 'main' && (
          <MainScreen
            onOpen={(symbol) => navigate({ name: 'detail', symbol })}
            onWatchlist={() => navigate({ name: 'watchlist' })}
            onSignals={() => navigate({ name: 'signals' })}
            onSim={() => navigate({ name: 'sim' })}
          />
        )}
        {current.name === 'watchlist' && (
          <WatchlistScreen
            onOpen={(symbol) => navigate({ name: 'detail', symbol })}
            onBack={back}
          />
        )}
        {current.name === 'asset' && (
          <AssetScreen onBack={back} />
        )}
        {current.name === 'signals' && (
          <SignalsScreen
            onBack={back}
            onOpenStock={(key) => {
              const [code, exchange] = key.split('.');
              navigate({ name: 'detail', symbol: { code, exchange: exchange as Symbol['exchange'] } });
            }}
          />
        )}
        {current.name === 'detail' && (
          <StockDetailScreen
            symbol={current.symbol}
            onBack={back}
            onTrade={(symbol, lastPrice) => navigate({ name: 'trade', symbol, lastPrice })}
          />
        )}
        {current.name === 'sim' && (
          <SimulationScreen />
        )}
        {current.name === 'trade' && (
          <TradeScreen symbol={current.symbol} lastPrice={current.lastPrice} onDone={back} />
        )}
        {current.name === 'settings' && (
          <SettingsScreen
            onBack={back}
            onOpenDebug={() => navigate({ name: 'debuglog' })}
            onOpenApiStats={() => navigate({ name: 'apistats' })}
          />
        )}
        {current.name === 'debuglog' && (
          <DebugLogScreen onBack={back} />
        )}
        {current.name === 'apistats' && (
          <ApiStatsScreen onBack={back} />
        )}
      </View>

      {showBar && (
        <SafeAreaView style={{ backgroundColor: colors.surface }} edges={['bottom']}>
          <BottomNavigation.Bar
            navigationState={navState}
            onTabPress={({ route }) => goTab(route.key as RouteName)}
            theme={theme}
            activeColor={colors.primary}
            inactiveColor={colors.textSecondary}
          />
        </SafeAreaView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
});
