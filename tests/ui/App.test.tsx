/**
 * App 入口 smoke：确保根模块可加载且导出默认组件（不做完整挂载，
 * 避免字体/导航/原生 mock 在 CI 无网环境下超时）。
 */
import { startQuantRuntime } from '@/quant/runtime';
import { evaluateProfile, createProfile } from '@/quant/profile';
import { STRATEGY_TEMPLATES, DEFAULT_TEMPLATE_ID } from '@/quant/core/templates';

describe('app bootstrap surface', () => {
  it('quant runtime exports start/stop', () => {
    expect(typeof startQuantRuntime).toBe('function');
  });

  it('profile model is wired to templates', () => {
    const p = createProfile([DEFAULT_TEMPLATE_ID]);
    expect(p.legs[0].templateId).toBe(DEFAULT_TEMPLATE_ID);
    expect(typeof evaluateProfile).toBe('function');
    expect(STRATEGY_TEMPLATES.length).toBeGreaterThan(0);
  });

  it('App.tsx default export exists', () => {
    // 只 require 模块图，不 render（避免 fonts/navigation 超时）
    jest.isolateModules(() => {
      jest.doMock('@/quant/runtime', () => ({ startQuantRuntime: jest.fn(), stopQuantRuntime: jest.fn(), setSignalNotifier: jest.fn(), recentStrategyEvents: () => [] }));
      jest.doMock('@/data/api', () => ({ marketData: { search: jest.fn(async () => []), pruneQuotesCache: jest.fn(), pruneDomainCache: jest.fn() }, applyUserPreferences: jest.fn() }));
      jest.doMock('@/data/db', () => ({ database: () => ({ prune: jest.fn() }) }));
      jest.doMock('@/data/sync/scheduler', () => ({ scheduleBackgroundSync: jest.fn() }));
      jest.doMock('@/quant/scheduler', () => ({ startSchedulerTicker: jest.fn(), stopSchedulerTicker: jest.fn(), ensureDefaultJobs: jest.fn(), setJobNotifySink: jest.fn(), registerJobKind: jest.fn() }));
      jest.doMock('@/features/notify/localDigest', () => ({}));
      jest.doMock('@/features/scanner/EodPickerScreen', () => ({}));
      jest.doMock('@/data/sync/registerSyncJob', () => ({}));
      jest.doMock('@/features/watchlist/alertCenter', () => ({
        AlertCenterProvider: ({ children }: { children: unknown }) => children,
        PollerBridge: () => null,
      }));
      jest.doMock('@/navigation/AppNavigator', () => ({ AppNavigator: () => null }));
      jest.doMock('@/settings/appPrefs', () => ({ getAppPrefs: jest.fn(async () => ({ hasOnboarded: true })) }));
      const App = require('../../App').default;
      expect(typeof App).toBe('function');
    });
  });
});
