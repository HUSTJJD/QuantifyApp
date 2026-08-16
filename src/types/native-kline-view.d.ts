/**
 * native-kline-view 模块类型声明。
 *
 * 该库（https://github.com/hellohublot/native-kline-view）未发布 TS 类型定义，
 * 这里仅声明本 App 实际用到的 props。optionList 必须是 JSON.stringify 后的字符串。
 */
declare module 'native-kline-view' {
  import type { ComponentType, Ref } from 'react';
  import type { StyleProp, ViewStyle } from 'react-native';

  export interface RNKLineViewProps {
    ref?: Ref<unknown>;
    style?: StyleProp<ViewStyle>;
    /** 必须是由 optionList 对象 JSON.stringify 得到的字符串 */
    optionList?: string;
    onDrawItemDidTouch?: (event: { nativeEvent: unknown }) => void;
    onDrawItemComplete?: (event: { nativeEvent: unknown }) => void;
    onDrawPointComplete?: (event: { nativeEvent: { pointCount: number } }) => void;
    /** 左滑到历史最左边界时触发，用于向数据源请求更早的 K 线（无限左滑到上市首日） */
    onLoadMoreBegin?: (event: { nativeEvent: { timestamp: number } }) => void;
  }

  export interface RNKLineViewHandle {
    /** 历史数据加载完成后，通知原生结束「加载更多」转圈并恢复交互 */
    resetLoadMoreEnd: () => void;
    /** 确认已无更早历史（已到上市首日），彻底关闭加载更多 */
    setLoadMoreEnd: () => void;
  }

  const RNKLineView: ComponentType<RNKLineViewProps>;
  export default RNKLineView;
}
