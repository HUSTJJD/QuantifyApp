/**
 * Jest mock：@wuba/react-native-echarts 依赖 Skia，node 环境不可用。
 */
const React = require('react');
const { View } = require('react-native');

function SkiaChart(props) {
  return React.createElement(View, {
    testID: 'echarts-skia-mock',
    style: props?.style,
  });
}

function SvgChart(props) {
  return React.createElement(View, {
    testID: 'echarts-svg-mock',
    style: props?.style,
  });
}

module.exports = { SkiaChart, SvgChart, SkiaRenderer: {}, SVGRenderer: {} };
