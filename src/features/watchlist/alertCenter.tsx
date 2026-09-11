/**
 * 异动通知中心（方向4：原生通知 UI 接入的客户端实现）。
 *
 * 不引入原生通知依赖（跨端成本大），改用 react-native-paper 的 Snackbar + Badge 实现
 * "应用内推送"：轮询服务探测到异动 → notify(events) → ①未读角标 +1（信号 tab）
 * ②弹出瞬时 Snackbar 提示。点击信号 tab 即标记已读。
 *
 * 设计为全局 Context，App 启动时把 `notify` 注入 watchlistPoller。
 * 纯逻辑（计数/去重/裁剪）抽成纯函数，便于单测。
 */
import React, { createContext, useCallback, useContext, useMemo, useReducer, useState } from 'react';
import { Snackbar } from 'react-native-paper';
import type { AlertEvent } from './alerts';

export interface AlertCenterState {
  unread: number;
  events: AlertEvent[]; // 最近 N 条，最新在前
}

const MAX_EVENTS = 50;

/** 纯函数：合并新事件，返回新 state（不修改入参）。 */
export function reduceNotify(state: AlertCenterState, events: AlertEvent[]): AlertCenterState {
  if (!events || events.length === 0) return state;
  const merged = [...events, ...state.events].slice(0, MAX_EVENTS);
  return { unread: state.unread + events.length, events: merged };
}

export function reduceMarkRead(state: AlertCenterState): AlertCenterState {
  if (state.unread === 0) return state;
  return { ...state, unread: 0 };
}

interface AlertCenterCtx {
  state: AlertCenterState;
  notify: (events: AlertEvent[]) => void;
  markRead: () => void;
}

const Ctx = createContext<AlertCenterCtx | null>(null);

export function AlertCenterProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, dispatch] = useReducer(
    (_: AlertCenterState, action: { type: 'notify'; events: AlertEvent[] } | { type: 'read' }) => {
      // 用纯函数计算，避免 reducer 内联副作用
      return action.type === 'notify' ? reduceNotify(_, action.events) : reduceMarkRead(_);
    },
    { unread: 0, events: [] },
  );
  const [snack, setSnack] = useState<AlertEvent | null>(null);

  const notify = useCallback((events: AlertEvent[]) => {
    dispatch({ type: 'notify', events });
    // 取最新一条做瞬时提示（避免一次多条刷屏）
    setSnack(events[events.length - 1] ?? null);
  }, []);

  const markRead = useCallback(() => dispatch({ type: 'read' }), []);

  const value = useMemo(() => ({ state, notify, markRead }), [state, notify, markRead]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <Snackbar
        visible={snack !== null}
        onDismiss={() => setSnack(null)}
        duration={4000}
        action={{ label: '查看', onPress: () => { markRead(); setSnack(null); } }}
      >
        {snack ? `${snack.symbol.name} ${snack.message}` : ''}
      </Snackbar>
    </Ctx.Provider>
  );
}

const DEFAULT_CTX: AlertCenterCtx = {
  state: { unread: 0, events: [] },
  notify: () => {},
  markRead: () => {},
};

/**
 * 读取通知中心。Provider 外（热更新/极少数边界）返回空实现，
 * 避免 Snackbar onDismiss 等路径在 Provider 卸载后抛错红屏。
 */
export function useAlertCenter(): AlertCenterCtx {
  return useContext(Ctx) ?? DEFAULT_CTX;
}

/**
 * 轮询桥：把 watchlistPoller 生命周期挂到 App 前台/后台状态，
 * 并把异动事件转发到通知中心（Snackbar + 角标）。
 * 必须放在 AlertCenterProvider 内部。
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { watchlistPoller } from './poller';
import { isTradingNow } from '@/utils/trading';
import { setSignalNotifier } from '@/quant/SignalEngine';

export function PollerBridge(): React.JSX.Element {
  const { notify } = useAlertCenter();

  useEffect(() => {
    // 仅在「前台 + 交易时段」轮询自选异动，非交易时段/后台不占用行情 QPS；
    // 午休/复市切换时由 30s 看门狗自动启停。
    const sync = () => {
      if (AppState.currentState === 'active' && isTradingNow()) {
        watchlistPoller.setNotifier(notify);
        watchlistPoller.start();
      } else {
        watchlistPoller.stop();
      }
    };
    watchlistPoller.setNotifier(notify);
    setSignalNotifier(notify);
    sync();
    const sub = AppState.addEventListener('change', () => sync());
    const watchdog = setInterval(sync, 30_000);
    return () => {
      sub.remove();
      clearInterval(watchdog);
      watchlistPoller.stop();
      setSignalNotifier(null);
    };
  }, [notify]);

  return <></>;
}
