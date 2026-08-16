/** react-native-vector-icons 在 node 测试环境的 mock：渲染为占位空组件，避免字体加载。 */
const React = require('react');
const { Text } = require('react-native');

const Icon = (props) => React.createElement(Text, null, props.name || '');

// 提供 .getImageSource 等静态方法兼容
Icon.getImageSource = () => Promise.resolve({});
Icon.getImageSourceSync = () => ({});
Icon.loadFont = () => Promise.resolve();

// 各图标集都映射到同一 mock（MaterialCommunityIcons 等）
module.exports = Icon;
module.exports.default = Icon;
