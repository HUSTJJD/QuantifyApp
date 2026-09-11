module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/src/__mocks__/jest.setup.js'],
  // RN 组件树 / 原生 mock 容易残留 timer 或异步句柄，强制退出避免 "Jest did not exit"
  forceExit: true,
  testPathIgnorePatterns: [
    '/node_modules/',
    // 本地 vendor 源码（stock-sdk 仓库）勿扫进 App 测试
    '/stock-sdk/',
    '/stock-dashboard/',
    '/kline-charts-react/',
  ],
  // 允许对 ESM 库（react-navigation/react-native-svg 等）进行 babel 转换（默认 node_modules 被忽略）
  // query-string → decode-uri-component@0.5 为 pure ESM，必须一并转换否则 App.test 无法 require
  transformIgnorePatterns: [
    'node_modules/(?!((react-native|react-native-svg|react-native-screens|@react-native|@react-navigation|react-native-vector-icons|react-native-safe-area-context|expo|expo-.*|@expo|expo-modules-core|stock-sdk|query-string|decode-uri-component)/))',
  ],
  moduleNameMapper: {
    // 解析 @/ 别名到 src/，与 metro/babel 保持一致（数据层为 @/data/* 真实路径）
    '^@/(.*)$': '<rootDir>/src/$1',
    // 原生存储模块在 node 测试环境用 CJS mock 替代
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/src/__mocks__/async-storage.mock.js',
    // 原生渐变模块在 node 测试环境用 mock 替代
    '^react-native-linear-gradient$':
      '<rootDir>/src/__mocks__/linear-gradient.mock.js',
    // 原生 K线模块在 node 测试环境用 mock 替代（ESM 入口，jest 无法渲染）
    '^react-native-kline-chart$':
      '<rootDir>/src/__mocks__/react-native-kline-chart.mock.js',
    '^@wuba/react-native-echarts/skiaChart$':
      '<rootDir>/src/__mocks__/react-native-echarts.mock.js',
    '^@wuba/react-native-echarts$':
      '<rootDir>/src/__mocks__/react-native-echarts.mock.js',
    // 图标库在 node 测试环境用 mock 替代（避免字体加载/渲染问题）
    '^react-native-vector-icons/MaterialCommunityIcons$':
      '<rootDir>/src/__mocks__/react-native-vector-icons.mock.js',
    '^react-native-vector-icons$':
      '<rootDir>/src/__mocks__/react-native-vector-icons.mock.js',
    // Skia 图表在 node 环境用空 View mock
    '^react-native-graph$': '<rootDir>/src/__mocks__/react-native-graph.mock.js',
  },
};
