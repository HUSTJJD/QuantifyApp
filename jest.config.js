module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/src/__mocks__/jest.setup.js'],
  // 允许对 ESM 库（如 react-native-svg）进行 babel 转换（默认 node_modules 被忽略）
  transformIgnorePatterns: [
    'node_modules/(?!((react-native|react-native-svg|@react-native|react-native-vector-icons|stock-sdk)/))',
  ],
  moduleNameMapper: {
    // 解析 @/ 别名到 src/，与 metro/babel 保持一致
    '^@/(.*)$': '<rootDir>/src/$1',
    // 原生存储模块在 node 测试环境用 CJS mock 替代
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/src/__mocks__/async-storage.mock.js',
    // 原生渐变模块在 node 测试环境用 mock 替代
    '^react-native-linear-gradient$':
      '<rootDir>/src/__mocks__/linear-gradient.mock.js',
    // 原生 K线模块在 node 测试环境用 mock 替代（ESM 入口，jest 无法渲染）
    '^native-kline-view$':
      '<rootDir>/src/__mocks__/native-kline-view.mock.js',
  },
};
