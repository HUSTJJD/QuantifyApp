const reactNative = require('@react-native/eslint-config/flat');

module.exports = [
  {
    ignores: ['native-kline-view/**'],
  },
  ...reactNative,
  {
    rules: {
      // react-native-paper 等组件以 render-function 作为 prop（如 List.Item 的 right/left）
      // 这是合法用法，并非在渲染期定义不稳定组件类型，故允许在 props 中传组件/render function。
      'react/no-unstable-nested-components': ['warn', { allowAsProps: true }],
      // 本项目大量使用主题色 / 条件样式，inline style 是有意为之
      'react-native/no-inline-styles': 'off',
      // UTF-8 polyfill / 颜色通道位运算是算法本身，非误用
      'no-bitwise': 'off',
    },
  },
];
