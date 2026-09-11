/**
 * Jest mock：react-native-graph 原生依赖（Skia/Reanimated）在 node 测试环境不可用。
 */
const React = require('react');
const { View } = require('react-native');

function LineGraph(props) {
  return React.createElement(View, {
    testID: 'rn-graph-mock',
    style: props?.style,
  });
}

module.exports = {
  LineGraph,
  GRAPH_BACKEND: 'skia',
};
