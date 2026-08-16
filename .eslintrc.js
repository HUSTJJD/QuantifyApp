module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // react-native-paper 等组件以 render-function 作为 prop（如 List.Item 的 right/left）
    // 这是合法用法，并非在渲染期定义不稳定组件类型，故允许在 props 中传组件/render function。
    'react/no-unstable-nested-components': ['warn', { allowAsProps: true }],
  },
};
