/**
 * Jest 测试环境 setup（运行于 setupFiles 阶段，此时测试框架钩子 afterAll 尚未注入）。
 * 原生存储模块已由 jest.config moduleNameMapper 映射到 CJS mock，
 * 此处仅保留可扩展的全局初始化（如清理计时器/关闭连接等）。
 */

// @op-engineering/op-sqlite：jest 无原生 SQLite 模块，
// 其顶层 import（NativeModules.OPSQLite）在 node 环境即会抛错。
// 在 require('@/db')（会 import 到 SqliteKlineAdapter）之前 mock 掉，
// 使 adapter 可被加载（isSqliteAvailable() 在 jest 下恒 false，
// 工厂实际仍用 AsyncStorage 引擎，单测行为不变）。
jest.mock('@op-engineering/op-sqlite', () => {
    const emptyResult = {
      rows: [],
      rowsAffected: 0,
      insertId: 0,
    };
    const makeConnection = () => ({
      execute: jest.fn(async () => ({ ...emptyResult })),
      executeSync: jest.fn(() => ({ ...emptyResult })),
      executeWithHostObjects: jest.fn(async () => ({ ...emptyResult })),
      executeBatch: jest.fn(async () => ({ rowsAffected: 0 })),
      executeRaw: jest.fn(async () => []),
      executeRawSync: jest.fn(() => []),
      prepareStatement: jest.fn(() => ({
        bind: jest.fn(),
        bindSync: jest.fn(),
        execute: jest.fn(async () => ({ ...emptyResult })),
        close: jest.fn(),
      })),
      transaction: jest.fn(async (fn) => {
        const tx = {
          execute: jest.fn(async () => ({ ...emptyResult })),
          commit: jest.fn(async () => ({ ...emptyResult })),
          rollback: jest.fn(() => ({ ...emptyResult })),
        };
        return fn(tx);
      }),
      close: jest.fn(),
      delete: jest.fn(),
      attach: jest.fn(),
      detach: jest.fn(),
    });
    return {
      __esModule: true,
      open: jest.fn(() => makeConnection()),
      openSync: jest.fn(() => makeConnection()),
      openRemote: jest.fn(() => makeConnection()),
      openV2: jest.fn(() => makeConnection()),
      OPSQLite: { open: jest.fn(() => makeConnection()) },
    };
});

const { closeDatabase } = require('@/db');

// react-test-renderer 在 node 环境需要最小 window/self polyfill
// （否则报 window.dispatchEvent is not a function）。仅补齐组件渲染所需。
if (typeof global.window === 'undefined') {
    const noop = () => {};
    global.window = global.window || global;
    global.window.dispatchEvent = global.window.dispatchEvent || noop;
    global.window.addEventListener = global.window.addEventListener || noop;
    global.window.removeEventListener = global.window.removeEventListener || noop;
    }
if (typeof global.self === 'undefined') {
    global.self = global;
    }

// 全部用例结束后关闭 K 线数据库单例，避免 SQLite / 句柄泄漏导致
// "Jest did not exit one second after the test run has completed"。
// 注意：本文件在 setupFiles（框架安装前）阶段执行，afterAll 不可用，
// 故改用框架无关的 process 退出钩子。
process.once('beforeExit', () => {
    closeDatabase().catch(() => {});
    });

// react-native-screens：jest 环境下没有原生视图，mock 其启用开关即可
// （native-stack 在测试渲染时走 JS fallback）。
jest.mock('react-native-screens', () => {
    const Actual = jest.requireActual('react-native-screens');
    return {
      __esModule: true,
      ...Actual,
      enableScreens: jest.fn(),
      enableFreeze: jest.fn(),
    };
});
