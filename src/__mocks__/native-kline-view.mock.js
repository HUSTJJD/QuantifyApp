/**
 * native-kline-view 在 node 测试环境下的 mock。
 * 该库为原生模块（含 ESM 入口），jest 无法真正渲染，这里仅输出占位 View。
 */
import React from 'react';
import { View, Text } from 'react-native';

const RNKLineView = (props) => {
  // 在测试环境下把 optionList 透出到 testID，便于断言组装正确性
  return React.createElement(
    View,
    { testID: 'native-kline-view' },
    React.createElement(Text, null, 'KLine')
  );
};

export default RNKLineView;
