/**
 * Jest mock：react-native-kline-chart 依赖 Skia，node 环境不可用。
 */
const React = require('react');
const { View } = require('react-native');

function KlineChart(props) {
  return React.createElement(View, {
    testID: 'kline-chart-mock',
    style: { width: props?.width, height: props?.height },
  });
}

function computeMA() {
  return [];
}

module.exports = { KlineChart, computeMA };
