/**
 * 缩放历史（撤销/重做）——移植自 kline-charts-react useZoomHistory。
 */
import { useCallback, useState } from 'react';

export interface ZoomState {
  start: number;
  end: number;
}

interface ZoomHistoryState {
  history: ZoomState[];
  index: number;
}

const DEFAULT_STATE: ZoomState = { start: 70, end: 100 };
const MAX_HISTORY = 50;

function isSameState(a: ZoomState, b: ZoomState): boolean {
  return a.start === b.start && a.end === b.end;
}

export function useZoomHistory(initialState: ZoomState = DEFAULT_STATE) {
  const [state, setState] = useState<ZoomHistoryState>({
    history: [initialState],
    index: 0,
  });

  const currentState = state.history[state.index] ?? initialState;

  const pushState = useCallback((next: ZoomState) => {
    setState((prev) => {
      const current = prev.history[prev.index];
      if (current && isSameState(current, next)) return prev;
      let history = prev.history.slice(0, prev.index + 1);
      history = [...history, next];
      if (history.length > MAX_HISTORY) {
        history = history.slice(history.length - MAX_HISTORY);
      }
      return { history, index: history.length - 1 };
    });
  }, []);

  const undo = useCallback((): ZoomState | null => {
    let result: ZoomState | null = null;
    setState((prev) => {
      if (prev.index === 0) return prev;
      const index = prev.index - 1;
      result = prev.history[index] ?? null;
      return { ...prev, index };
    });
    return result;
  }, []);

  const redo = useCallback((): ZoomState | null => {
    let result: ZoomState | null = null;
    setState((prev) => {
      if (prev.index >= prev.history.length - 1) return prev;
      const index = prev.index + 1;
      result = prev.history[index] ?? null;
      return { ...prev, index };
    });
    return result;
  }, []);

  const reset = useCallback(
    (next: ZoomState = initialState) => {
      setState({ history: [next], index: 0 });
    },
    [initialState],
  );

  return {
    canUndo: state.index > 0,
    canRedo: state.index < state.history.length - 1,
    currentState,
    pushState,
    undo,
    redo,
    reset,
  };
}
