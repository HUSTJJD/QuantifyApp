/**
 * 导航容器（react-navigation v7）。
 *
 * 结构：
 *   Root NativeStack
 *   ├── Tabs（BottomTabNavigator：行情/自选/信号/模拟盘/我的）
 *   ├── Watchlist（自选管理：异动提醒/异动历史/删除）/ Asset / Settings / DebugLog / ApiStats / Backtest（二级页）
 *   └── Detail / Trade（个股详情/交易，天然无底栏）
 *
 * 各业务页组件保持原有 props 接口（onBack/onOpen*），在此处用 navigation 适配，
 * 业务页不感知导航实现（后续可平滑改造成 useNavigation 风格）。
 */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { Symbol } from '@/data/api';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { MainScreen } from '@/features/home/MainScreen';
import { StockDetailScreen } from '@/features/stock/StockDetailScreen';
import { WatchlistScreen } from '@/features/watchlist/WatchlistScreen';
import { WatchlistTabScreen } from '@/features/watchlist/WatchlistTabScreen';
import { AssetScreen } from '@/features/asset/AssetScreen';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { StrategiesScreen } from '@/features/quant/StrategiesScreen';
import { StrategyEditScreen } from '@/features/quant/StrategyEditScreen';
import { StrategyBacktestScreen } from '@/features/quant/StrategyBacktestScreen';
import { StrategySimScreen } from '@/features/quant/StrategySimScreen';
import { DebugLogScreen } from '@/features/debug/DebugLogScreen';
import { ApiStatsScreen } from '@/features/debug/ApiStatsScreen';
import { SourceTestScreen } from '@/features/debug/SourceTestScreen';
import { SimulationScreen } from '@/features/simulation/SimulationScreen';
import { TradeScreen } from '@/features/simulation/TradeScreen';
import { MineScreen } from '@/features/mine/MineScreen';
import { BacktestScreen } from '@/features/backtest/BacktestScreen';
import { ScannerScreen } from '@/features/scanner/ScannerScreen';
import { WorkflowScreen } from '@/features/scanner/WorkflowScreen';
import { SearchScreen } from '@/features/search/SearchScreen';
import { AlertRulesScreen } from '@/features/watchlist/AlertRulesScreen';
import { useAlertCenter } from '@/features/watchlist/alertCenter';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';
import { useAppTheme } from '@/theme/ThemeProvider';

/** 根 Stack 路由参数表 */
export type RootStackParamList = {
  Tabs: undefined;
  Watchlist: undefined;
  Asset: undefined;
  Detail: { symbol: Symbol };
  Trade: { symbol: Symbol; lastPrice: number };
  Settings: undefined;
  DebugLog: undefined;
  ApiStats: undefined;
  /** 行情源统计 → 单源测试 */
  SourceTest: { sourceId: string };
  Backtest: undefined;
  Scanner: undefined;
  Workflow: undefined;
  Search: undefined;
  AlertRules: undefined;
  /** 策略编辑（新建不传 strategyId；删除策略后模板可再次新建） */
  StrategyEdit: { strategyId?: string };
  StrategyBacktest: { strategyId: string };
  StrategySim: { strategyId: string };
};

/** 底部 Tab 路由参数表 */
export type MainTabParamList = {
  Main: undefined;
  Watchlist: undefined;
  Signals: undefined;
  Sim: undefined;
  Mine: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

type RootNav = NativeStackNavigationProp<RootStackParamList>;
type TabNav = BottomTabNavigationProp<MainTabParamList>;

/** 安全返回：栈底时回落到 Tabs，避免 GO_BACK 未处理警告 */
function safeGoBack(navigation: NativeStackNavigationProp<RootStackParamList>): void {
  if (navigation.canGoBack()) {
    navigation.goBack();
  } else {
    navigation.navigate('Tabs');
  }
}

/** 底部导航栏 5 tab 定义：行情/自选/信号/模拟盘/我的 */
const TABS: { key: keyof MainTabParamList; title: string; icon: string }[] = [
  { key: 'Main', title: '行情', icon: Icons.home },
  { key: 'Watchlist', title: '自选', icon: Icons.watchlist },
  { key: 'Signals', title: '策略', icon: Icons.strategy },
  { key: 'Sim', title: '模拟盘', icon: Icons.sim },
  { key: 'Mine', title: '我的', icon: Icons.user },
];

/** 底部 Tab 导航器（5 个主页面） */
function MainTabs(): React.JSX.Element {
  const { colors } = useAppTheme();
  const { state: alertState, markRead } = useAlertCenter();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface },
        tabBarIcon: ({ color, size }) => {
          const t = TABS.find((x) => x.key === route.name);
          return <Icon name={t?.icon ?? Icons.home} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Main">
        {({ navigation }: { navigation: TabNav }) => {
          const root = navigation.getParent<RootNav>();
          return (
            <MainScreen
              onOpen={(symbol) => root?.navigate('Detail', { symbol })}
              onSearch={() => root?.navigate('Search')}
            />
          );
        }}
      </Tab.Screen>
      <Tab.Screen name="Watchlist">
        {({ navigation }: { navigation: TabNav }) => {
          const root = navigation.getParent<RootNav>();
          return (
            <WatchlistTabScreen
              onOpen={(symbol) => root?.navigate('Detail', { symbol })}
              onManage={() => root?.navigate('Watchlist')}
              onSearch={() => root?.navigate('Search')}
            />
          );
        }}
      </Tab.Screen>
      <Tab.Screen
        name="Signals"
        options={{
          // 信号 tab 未读角标（进入即清除）
          tabBarBadge: alertState.unread > 0 ? alertState.unread : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.up, color: '#fff' },
        }}
        listeners={{
          tabPress: () => {
            if (alertState.unread > 0) markRead();
          },
        }}
      >
        {({ navigation }: { navigation: TabNav }) => {
          const root = navigation.getParent<RootNav>();
          return (
            <StrategiesScreen
              onEdit={(id) => root?.navigate('StrategyEdit', { strategyId: id })}
              onCreate={() => root?.navigate('StrategyEdit', {})}
              onBacktest={(id) => root?.navigate('StrategyBacktest', { strategyId: id })}
              onOpenSim={(id) => root?.navigate('StrategySim', { strategyId: id })}
              onOpenStock={(key) => {
                const [code, exchange] = key.split('.');
                root?.navigate('Detail', { symbol: { code, exchange: exchange as Symbol['exchange'] } });
              }}
              onOpenScanner={() => root?.navigate('Scanner')}
              onOpenWorkflow={() => root?.navigate('Workflow')}
            />
          );
        }}
      </Tab.Screen>
      <Tab.Screen name="Sim">
        {() => <SimulationScreen />}
      </Tab.Screen>
      <Tab.Screen name="Mine">
        {({ navigation }: { navigation: TabNav }) => {
          const root = navigation.getParent<RootNav>();
          return (
            <MineScreen
              onOpenAsset={() => root?.navigate('Asset')}
              onOpenSettings={() => root?.navigate('Settings')}
              onOpenApiStats={() => root?.navigate('ApiStats')}
              onOpenDebug={() => root?.navigate('DebugLog')}
              onOpenBacktest={() => root?.navigate('Backtest')}
              onOpenScanner={() => root?.navigate('Scanner')}
              onOpenWorkflow={() => root?.navigate('Workflow')}
              onOpenAlertRules={() => root?.navigate('AlertRules')}
            />
          );
        }}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

/** 根 Stack 导航器：Tab + 二级页 + 详情/交易 */
export function AppNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={MainTabs} />
      <Stack.Screen name="Watchlist">
        {({ navigation }: { navigation: RootNav }) => (
          <WatchlistScreen
            onOpen={(symbol) => navigation.navigate('Detail', { symbol })}
            onBack={() => safeGoBack(navigation)}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Asset">
        {({ navigation }: { navigation: RootNav }) => (
          <AssetScreen onBack={() => safeGoBack(navigation)} />
        )}
      </Stack.Screen>
      <Stack.Screen name="Detail">
        {({ navigation, route }: { navigation: RootNav; route: { params: RootStackParamList['Detail'] } }) => (
          <StockDetailScreen
            symbol={route.params.symbol}
            onBack={() => safeGoBack(navigation)}
            onTrade={(symbol, lastPrice) => navigation.navigate('Trade', { symbol, lastPrice })}
            onOpenSymbol={(s) => navigation.push('Detail', { symbol: s })}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Trade">
        {({ navigation, route }: { navigation: RootNav; route: { params: RootStackParamList['Trade'] } }) => (
          <TradeScreen
            symbol={route.params.symbol}
            lastPrice={route.params.lastPrice}
            onDone={() => safeGoBack(navigation)}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Settings">
        {({ navigation }: { navigation: RootNav }) => (
          <SettingsScreen
            onBack={() => safeGoBack(navigation)}
            onOpenDebug={() => navigation.navigate('DebugLog')}
            onOpenApiStats={() => navigation.navigate('ApiStats')}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="DebugLog">
        {({ navigation }: { navigation: RootNav }) => (
          <DebugLogScreen onBack={() => safeGoBack(navigation)} />
        )}
      </Stack.Screen>
      <Stack.Screen name="ApiStats">
        {({ navigation }: { navigation: RootNav }) => (
          <ApiStatsScreen
            onBack={() => safeGoBack(navigation)}
            onOpenTest={(sourceId) => navigation.navigate('SourceTest', { sourceId })}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="SourceTest">
        {({ navigation, route }: { navigation: RootNav; route: { params: RootStackParamList['SourceTest'] } }) => (
          <SourceTestScreen sourceId={route.params.sourceId} onBack={() => safeGoBack(navigation)} />
        )}
      </Stack.Screen>
      <Stack.Screen name="Backtest">
        {({ navigation }: { navigation: RootNav }) => (
          <BacktestScreen onBack={() => safeGoBack(navigation)} />
        )}
      </Stack.Screen>
      <Stack.Screen name="Scanner">
        {({ navigation }: { navigation: RootNav }) => (
          <ScannerScreen
            onBack={() => safeGoBack(navigation)}
            onOpenDetail={(symbol) => navigation.navigate('Detail', { symbol })}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Workflow">
        {({ navigation }: { navigation: RootNav }) => (
          <WorkflowScreen
            onBack={() => safeGoBack(navigation)}
            onOpenDetail={(symbol) => navigation.navigate('Detail', { symbol })}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="StrategyEdit">
        {({ navigation, route }: { navigation: RootNav; route: { params: RootStackParamList['StrategyEdit'] } }) => (
          <StrategyEditScreen
            strategyId={route.params?.strategyId}
            onBack={() => safeGoBack(navigation)}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="StrategyBacktest">
        {({ navigation, route }: { navigation: RootNav; route: { params: RootStackParamList['StrategyBacktest'] } }) => (
          <StrategyBacktestScreen
            strategyId={route.params.strategyId}
            onBack={() => safeGoBack(navigation)}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="StrategySim">
        {({ navigation, route }: { navigation: RootNav; route: { params: RootStackParamList['StrategySim'] } }) => (
          <StrategySimScreen
            strategyId={route.params.strategyId}
            onBack={() => safeGoBack(navigation)}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Search">
        {({ navigation }: { navigation: RootNav }) => (
          <SearchScreen
            onBack={() => safeGoBack(navigation)}
            onOpenStock={(symbol) => navigation.navigate('Detail', { symbol })}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="AlertRules">
        {({ navigation }: { navigation: RootNav }) => (
          <AlertRulesScreen onBack={() => safeGoBack(navigation)} />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
