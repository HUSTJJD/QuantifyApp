/**
 * 应用根组件。
 *  - 在启动时注入同花顺 API Key（从安全存储/环境变量读取，绝不写死）；
 *  - 初始化统一行情客户端（按配置选择主/备数据源）；
 *  - 展示启动动画后渲染导航容器；
 *  - 用 react-native-paper 的 PaperProvider 提供统一 Material 组件主题。
 */
import React, { useEffect } from 'react';
import { StatusBar, AppState, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider as PaperProvider, MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import { useFonts } from 'expo-font';
import { NavigationContainer } from '@react-navigation/native';
import { marketData, applyUserPreferences } from '@/data/api';
import { database } from '@/data/db';
import { AppNavigator } from '@/navigation/AppNavigator';
import { ThemeProvider, useAppTheme } from '@/theme/ThemeProvider';
import { startSignalEngine } from '@/quant/SignalEngine';
import { startStrategyEngine } from '@/quant/StrategyEngine';
import { AlertCenterProvider, PollerBridge } from '@/features/watchlist/alertCenter';
import { scheduleBackgroundSync } from '@/data/sync/scheduler';
import { OnboardingScreen } from '@/features/onboarding/OnboardingScreen';
import { DigestBridge } from '@/features/notify/DigestBridge';
import { getAppPrefs } from '@/settings/appPrefs';
import '@/features/notify/localDigest';
import '@/features/scanner/EodPickerScreen';
import '@/data/sync/registerSyncJob';
import {
  startSchedulerTicker,
  stopSchedulerTicker,
  ensureDefaultJobs,
  setJobNotifySink,
} from '@/quant/scheduler';
import { sendNotify } from '@/features/notify/channels';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

/** PaperProvider 的图标渲染器（顶层组件，避免渲染期反复重建）。
 * 注意：react-native-paper 可能以「函数调用」而非 JSX 调用 settings.icon，
 * 不能在内部使用 Hooks（含 React Compiler 注入的 cache hook）。 */
function PaperIcon(props: React.ComponentProps<typeof MaterialCommunityIcons>): React.JSX.Element {
  return <MaterialCommunityIcons {...props} />;
}

// API Key 注入策略（无后端，Key 在客户端管理）：
//  1. 用户可在 App 内自己设置（持久化到本地存储，最高优先级）；
//  2. 未设置时，可临时用构建期环境变量 THS_API_KEY 注入（仅测试用，不落盘）；
//  3. 严禁把真实 Key 写死进代码/默认值。
function App(): React.JSX.Element {
  // MaterialCommunityIcons：迁移 Expo 后由 expo-font 从 assets/fonts 加载
  const [fontsLoaded] = useFonts({
    MaterialCommunityIcons: require('./assets/fonts/MaterialCommunityIcons.ttf'),
  });

  useEffect(() => {
    // 回灌用户偏好（主数据源选择 + Key）；传入测试用环境变量 Key
    applyUserPreferences(process.env.THS_API_KEY).catch(() => undefined);
    // 预热主源（失败不阻塞 UI，首个真实请求会再次触发）
    marketData.search('茅台').catch(() => undefined);
    // 启动清理过期的 K 线本地缓存：仅清「>90 天未更新」的残留（如已删除标的），
    // 正常追溯历史 updatedAt 为最近写入，不受影响（本地全量追溯数据长期保留）。
    database()
      .prune(Date.now() - 90 * 24 * 3600 * 1000)
      .catch(() => undefined);
    // 启动清理过期的行情快照缓存
    marketData.pruneQuotesCache().catch(() => undefined);
    // 启动个人量化信号引擎（随交易时段行情推送自动重算）
    startSignalEngine();
    // 启动策略自动交易运行时（开启「自动交易」的策略独立模拟盘，随行情推送触发买卖/风控）
    startStrategyEngine();
    // 后台全市场增量同步（全市场标的库 + 日 K 增量；延迟执行不阻塞启动，单进程只跑一轮）
    scheduleBackgroundSync();
    // 统一本地调度器
    ensureDefaultJobs().catch(() => undefined);
    setJobNotifySink((job, run) => {
      if (run.status === 'ok' || run.status === 'error') {
        void sendNotify({
          title: job.title,
          body: run.summary || run.error || run.status,
          data: { jobId: job.id, kind: job.kind, status: run.status },
        });
      }
    });
    startSchedulerTicker();
    // 切回前台时再清理一次过期行情缓存，确保旧快照不会跨日残留
    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') marketData.pruneQuotesCache().catch(() => undefined);
    });
    return () => {
      appStateSub.remove();
      stopSchedulerTicker();
    };
  }, []);

  if (!fontsLoaded) {
    return <View style={styles.root} />;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AlertCenterProvider>
            <AppInner />
            <PollerBridge />
          </AlertCenterProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** ThemeProvider 内部：拿到主题 mode 后驱动 Paper / StatusBar。 */
function AppInner(): React.JSX.Element {
  const { mode } = useAppTheme();
  const [onboarded, setOnboarded] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    getAppPrefs()
      .then((p) => setOnboarded(p.hasOnboarded))
      .catch(() => setOnboarded(true));
  }, []);

  // 用户未显式设置时跟随系统；设置后跟随用户（ThemeProvider 默认 dark，这里以 mode 为准）
  const isDark = mode === 'light' ? false : true;

  const paperTheme = isDark
    ? { ...MD3DarkTheme, colors: { ...MD3DarkTheme.colors, primary: '#11BEBC' } }
    : { ...MD3LightTheme, colors: { ...MD3LightTheme.colors, primary: '#00A19F' } };

  if (onboarded === null) {
    return <View style={styles.root} />;
  }

  if (!onboarded) {
    return (
      <PaperProvider theme={paperTheme} settings={{ icon: PaperIcon }}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        <OnboardingScreen onDone={() => setOnboarded(true)} />
      </PaperProvider>
    );
  }

  return (
    <PaperProvider theme={paperTheme} settings={{ icon: PaperIcon }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
      <DigestBridge />
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

export default App;
