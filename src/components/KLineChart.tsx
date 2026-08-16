/**
 * KLineChart —— 基于 native-kline-view 原生 K线组件的 App 级复用封装。
 *
 * 特性：
 *  - 直接吃本 App 统一的 Candle[]（来自 useKline）；
 *  - 内置指标计算（MA/BOLL/MACD/KDJ/RSI/WR，由 indicators.ts 提供）；
 *  - 支持主图/副图指标切换、周期自动映射；
 *  - 自动处理 iOS Fabric 下的 View 包裹（参照库示例 renderKLineChart）；
 *  - optionList 以 JSON 字符串传给原生端（库要求）。
 *
 * 注意：原生组件只能在真机/模拟器渲染，无法在 jest/node 环境出图；
 *   本组件保持纯数据+字符串组装，便于单测 optionList 结构。
 */
import React, {
  useMemo,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
  Component,
  type ReactNode,
} from 'react';
import { View, Text, StyleSheet, Platform, UIManager, findNodeHandle } from 'react-native';
import RNKLineView from 'native-kline-view';
import type { Candle, KlinePeriod } from '@/api';
import { colors, spacing, fontSize, radius } from '@/theme';
import { buildOptionList, type MainIndicator, type SubIndicator } from './kline/optionList';
import { logger } from '@/utils/logger';

/**
 * 原生 K线组件偶发崩溃（如原生层 NPE）不应拖垮整个 App。
 * 用 ErrorBoundary 兜住，渲染降级 UI，并把错误写进调试日志。
 */
class KLineBoundary extends Component<
  { children: ReactNode; height: number },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    logger.error('KLineChart', `原生K线渲染异常降级: ${String(error)}`);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={[styles.empty, { height: this.props.height }]}>
          <Text style={styles.hint}>K线图暂时无法显示</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export interface KLineChartProps {
  data: Candle[];
  /** K线周期，用于映射到原生 time 字段 */
  period: KlinePeriod;
  height?: number;
  /** 主图指标，默认 ma */
  mainIndicator?: MainIndicator;
  /** 副图指标，默认 macd */
  subIndicator?: SubIndicator;
  /** 价格精度，默认 2 */
  pricePrecision?: number;
  /** 暗色主题，默认跟随 App 暗色 */
  isDark?: boolean;
  /**
   * 左滑到历史最左边界时触发，用于向数据源请求更早的 K 线（无限左滑到上市首日）。
   * 返回 Promise<boolean>：true 表示已加载更早数据（还有更多），false 表示已到最早（上市首日）。
   */
  onLoadMore?: () => Promise<boolean>;
}

function KLineInner({
  optionList,
  height,
  onLoadMore,
  innerRef,
}: {
  optionList: string;
  height: number;
  onLoadMore?: () => Promise<boolean>;
  innerRef: React.Ref<unknown>;
}): React.JSX.Element {
  const ref = useRef<unknown>(null);
  const loadingRef = useRef(false);

  // 终极防御：若字符串中仍残留 null/NaN（理论上 sanitize 已兜住），不传给原生以免 NPE 闪退，
  // 并写入调试日志，便于在「设置 → 调试日志」定位真实数据问题。
  const safeOptionList = useMemo(() => {
    if (/null|NaN/.test(optionList)) {
      logger.error('KLineChart', 'optionList 检测到残留 null/NaN，已阻断传给原生层');
      return '';
    }
    return optionList;
  }, [optionList]);

  // 通过 UIManager 分发原生命令（兼容新架构 Fabric：直接 ref.method 在新架构下不生效）
  // 注：Flow 类型把 dispatchViewManagerCommand 的 commandID 标成 number，但运行时接受字符串命令名，故用 any 桥接
  const dispatchCommand = useCallback((command: 'resetLoadMoreEnd' | 'setLoadMoreEnd') => {
    const node = ref.current as unknown;
    const handle = node ? findNodeHandle(node as never) : null;
    if (handle == null) return;
    (UIManager.dispatchViewManagerCommand as any)(handle, command, []);
  }, []);

  const handleLoadMoreBegin = useCallback(() => {
    logger.debug('KLineChart', '[onLoadMoreBegin] 原生事件触发');
    if (!onLoadMore || loadingRef.current) {
      logger.debug('KLineChart', '[onLoadMoreBegin] 被忽略', { hasOnLoadMore: !!onLoadMore, loading: loadingRef.current });
      return;
    }
    loadingRef.current = true;
    Promise.resolve()
      .then(() => onLoadMore())
      .catch((e) => {
        logger.error('KLineChart', `加载更早K线失败: ${String(e)}`);
        return true; // 失败默认允许再次触发，避免锁死
      })
      .then((hasMore) => {
        loadingRef.current = false;
        logger.debug('KLineChart', '[onLoadMoreBegin] 结果', { hasMore });
        if (hasMore) {
          dispatchCommand('resetLoadMoreEnd');
        } else {
          dispatchCommand('setLoadMoreEnd');
        }
      });
  }, [onLoadMore, dispatchCommand]);

  const chart = (
    <RNKLineView
      ref={(node: unknown) => {
        (ref as React.MutableRefObject<unknown>).current = node;
        if (typeof innerRef === 'function') innerRef(node);
        else if (innerRef) (innerRef as React.MutableRefObject<unknown>).current = node;
      }}
      style={[styles.chart, { height }]}
      optionList={safeOptionList}
      onLoadMoreBegin={onLoadMore ? handleLoadMoreBegin : undefined}
    />
  );

  // iOS 在 Fabric 下可直接渲染；否则需包 collapsable={false} 的 View 防止测量失效
  if (typeof globalThis !== 'undefined' && (globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager && Platform.OS === 'ios') {
    return chart;
  }
  return (
    <View style={{ height }} collapsable={false}>
      <View style={styles.flex} collapsable={false}>
        <View style={[styles.chartWrap, { height }]} collapsable={false}>
          {chart}
        </View>
      </View>
    </View>
  );
}

export const KLineChart = forwardRef<KLineChartHandle, KLineChartProps>((props: KLineChartProps, ref) => {
  const {
    data,
    period,
    height = 260,
    mainIndicator = 'ma',
    subIndicator = 'macd',
    pricePrecision = 2,
    isDark = true,
    onLoadMore,
  } = props;
  const optionList = useMemo(() => {
    if (!data || data.length === 0) return '';
    return buildOptionList(data, {
      period,
      main: mainIndicator,
      sub: subIndicator,
      pricePrecision,
      isDark,
    });
  }, [data, period, mainIndicator, subIndicator, pricePrecision, isDark]);

  const innerRef = useRef<unknown>(null);

  const dispatchToNative = useCallback((command: 'resetLoadMoreEnd' | 'setLoadMoreEnd') => {
    const node = innerRef.current as unknown;
    const handle = node ? findNodeHandle(node as never) : null;
    if (handle == null) return;
    (UIManager.dispatchViewManagerCommand as any)(handle, command, []);
  }, []);

  useImperativeHandle(ref, () => ({
    resetLoadMoreEnd: () => dispatchToNative('resetLoadMoreEnd'),
    setLoadMoreEnd: () => dispatchToNative('setLoadMoreEnd'),
  }), [dispatchToNative]);

  if (!data || data.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.hint}>该周期暂无数据</Text>
      </View>
    );
  }

  return (
    <KLineBoundary height={height}>
      <KLineInner optionList={optionList} height={height} onLoadMore={onLoadMore} innerRef={innerRef} />
    </KLineBoundary>
  );
});

export interface KLineChartHandle {
  /** 历史数据加载完成后，通知原生结束「加载更多」转圈并恢复交互 */
  resetLoadMoreEnd: () => void;
  /** 确认已无更早历史（已到上市首日），彻底关闭加载更多 */
  setLoadMoreEnd: () => void;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chart: { flex: 1, backgroundColor: 'transparent' },
  chartWrap: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md },
  empty: { alignItems: 'center', justifyContent: 'center' },
  hint: { color: colors.textSecondary, fontSize: fontSize.sm, paddingVertical: spacing.md, textAlign: 'center' },
});
