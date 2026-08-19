/**
 * 应用根组件。
 *  - 在启动时注入同花顺 API Key（从安全存储/环境变量读取，绝不写死）；
 *  - 初始化统一行情客户端（按配置选择主/备数据源）；
 *  - 展示启动动画后渲染导航容器；
 *  - 用 react-native-paper 的 PaperProvider 提供统一 Material 组件主题。
 */
import React, { useEffect, useState } from 'react';
import { StatusBar, AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider as PaperProvider, MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
// import { MaterialCommunityIcons } from 'react-native-vector-icons/MaterialCommunityIcons';
import { marketData, applyUserPreferences } from '@/api';
import { AppNavigator } from '@/navigation/AppNavigator';
import { SplashScreen } from '@/components/SplashScreen';
import { ThemeProvider, useAppTheme } from '@/theme/ThemeProvider';
import { startSignalEngine } from '@/quant/SignalEngine';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

/** PaperProvider 的图标渲染器（顶层组件，避免渲染期反复重建）。 */
function PaperIcon(props: React.ComponentProps<typeof MaterialCommunityIcons>): React.JSX.Element {
  return <MaterialCommunityIcons {...props} />;
}

// API Key 注入策略（无后端，Key 在客户端管理）：
//  1. 用户可在 App 内自己设置（持久化到本地存储，最高优先级）；
//  2. 未设置时，可临时用构建期环境变量 THS_API_KEY 注入（仅测试用，不落盘）；
//  3. 严禁把真实 Key 写死进代码/默认值。
function App(): React.JSX.Element {
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    // 回灌用户偏好（主数据源选择 + Key）；传入测试用环境变量 Key
    applyUserPreferences(process.env.THS_API_KEY).catch(() => undefined);
    // 预热主源（失败不阻塞 UI，首个真实请求会再次触发）
    marketData.search('茅台').catch(() => undefined);
    // 启动清理过期的 K 线本地缓存（增量缓存的过期物理删除）
    marketData.pruneKlineCache().catch(() => undefined);
    // 启动清理过期的行情快照缓存
    marketData.pruneQuotesCache().catch(() => undefined);
    // 启动个人量化信号引擎（随交易时段行情推送自动重算）
    startSignalEngine();
    // 切回前台时再清理一次过期行情缓存，确保旧快照不会跨日残留
    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') marketData.pruneQuotesCache().catch(() => undefined);
    });
    return () => appStateSub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
      {!splashDone && <SplashScreen onFinish={() => setSplashDone(true)} />}
    </SafeAreaProvider>
  );
}

/** ThemeProvider 内部：拿到主题 mode 后驱动 Paper / StatusBar。 */
function AppInner(): React.JSX.Element {
  const { mode } = useAppTheme();
  // 用户未显式设置时跟随系统；设置后跟随用户（ThemeProvider 默认 dark，这里以 mode 为准）
  const isDark = mode === 'light' ? false : true;

  const paperTheme = isDark
    ? { ...MD3DarkTheme, colors: { ...MD3DarkTheme.colors, primary: '#E5484D' } }
    : { ...MD3LightTheme, colors: { ...MD3LightTheme.colors, primary: '#E5484D' } };

  return (
    <PaperProvider theme={paperTheme} settings={{ icon: PaperIcon }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <AppNavigator />
    </PaperProvider>
  );
}

export default App;
