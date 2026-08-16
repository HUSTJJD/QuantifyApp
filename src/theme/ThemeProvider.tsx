/**
 * 主题 Context：提供亮/暗模式切换与当前色板。
 * 持久化到本地存储，重启保持。业务页通过 useAppTheme() 取色。
 */
import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, type ReactNode } from 'react';
import { storage, StorageKeys } from '@/storage';
import { getColors, DarkColors, type ColorScheme, type ThemeMode } from './index';

interface ThemeCtx {
  mode: ThemeMode;
  colors: ColorScheme;
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
}

const Ctx = createContext<ThemeCtx>({ mode: 'dark', colors: DarkColors, toggle: () => {}, setMode: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [mode, setModeState] = useState<ThemeMode>('dark');

  useEffect(() => {
    storage.getString(StorageKeys.THEME_MODE).then((v) => {
      if (v === 'light' || v === 'dark') setModeState(v);
    });
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    storage.setString(StorageKeys.THEME_MODE, m);
  }, []);
  const toggle = useCallback(() => setMode(mode === 'dark' ? 'light' : 'dark'), [mode, setMode]);

  const value = useMemo<ThemeCtx>(() => ({ mode, colors: getColors(mode), toggle, setMode }), [mode, toggle, setMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppTheme(): ThemeCtx {
  return useContext(Ctx);
}
