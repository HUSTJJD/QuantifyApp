/**
 * @format
 *
 * App 冒烟测试：验证根组件可挂载。
 * 引擎 / 启动动画 / 行情轮询 / 自选异动看门狗会在 node 环境留下 open handles，
 * 这里 mock 掉副作用模块并主动 unmount，避免 Jest 挂起。
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('@/quant/SignalEngine', () => ({
  startSignalEngine: jest.fn(),
  stopSignalEngine: jest.fn(),
}));

jest.mock('@/quant/StrategyEngine', () => ({
  startStrategyEngine: jest.fn(),
  stopStrategyEngine: jest.fn(),
}));

jest.mock('@/data/sync/scheduler', () => ({
  scheduleBackgroundSync: jest.fn(),
  runBackgroundSync: jest.fn(async () => ({ durationMs: 0, failed: 0, errors: [] })),
  resetSyncScheduler: jest.fn(),
  DAILY_MARKER_SYMBOL: '__SYNC_DAILY__',
  DAILY_MARKER_PERIOD: 'day',
}));

// 启动页含 1.6s 动画计时器，测试环境直接完成
jest.mock('@/components/SplashScreen', () => ({
  SplashScreen: ({ onFinish }: { onFinish: () => void }) => {
    const { useEffect } = require('react');
    useEffect(() => {
      onFinish();
    }, [onFinish]);
    return null;
  },
}));

// 行情推送轮询（setInterval）在测试环境不启动
jest.mock('@/data/QuoteFeed', () => ({
  quoteFeed: {
    onQuote: null,
    subscribe: jest.fn(),
    subscribeListener: jest.fn(() => () => undefined),
    snapshotFor: jest.fn(() => null),
    refreshNow: jest.fn(async () => undefined),
    subscribedCount: jest.fn(() => 0),
  },
}));

// 自选异动轮询桥含 30s 看门狗 setInterval
jest.mock('@/features/watchlist/alertCenter', () => ({
  AlertCenterProvider: ({ children }: { children: React.ReactNode }) =>
    children as React.ReactElement,
  PollerBridge: () => null,
  useAlertCenter: () => ({ state: { unread: 0, events: [] }, notify: jest.fn(), markRead: jest.fn() }),
}));

// 只验证根树可挂载，不展开全部业务屏（各屏会订阅行情/启停引擎）
jest.mock('@/navigation/AppNavigator', () => ({
  AppNavigator: () => null,
}));

jest.mock('@/data/api', () => {
  const actual = jest.requireActual('@/data/api');
  return {
    ...actual,
    marketData: {
      ...actual.marketData,
      search: jest.fn(async () => []),
      pruneQuotesCache: jest.fn(async () => undefined),
      getQuotes: jest.fn(async () => []),
    },
    applyUserPreferences: jest.fn(async () => undefined),
  };
});

// App 启动会 prune 数据库；node 环境避免真实开库留下句柄
jest.mock('@/data/db', () => ({
  database: () => ({
    prune: jest.fn(async () => undefined),
  }),
  closeDatabase: jest.fn(async () => undefined),
  resetDatabase: jest.fn(),
}));

jest.mock('@/data/db/storage', () => ({
  storage: {
    getString: jest.fn(async () => null),
    setString: jest.fn(async () => undefined),
  },
  StorageKeys: { THEME_MODE: 'theme_mode' },
}));

test('renders correctly', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });
  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});
