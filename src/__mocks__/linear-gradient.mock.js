/**
 * react-native-linear-gradient 的 jest mock（原生模块，node 测试环境无法加载）。
 * 仅返回一个透传 children 的 View，足以在单测下渲染。
 */
const React = require('react');
const { View } = require('react-native');

const LinearGradient = (props) => React.createElement(View, props, props.children);

module.exports = LinearGradient;
module.exports.default = LinearGradient;
