/**
 * 主题 Context：亮/暗 + 涨跌色方案。持久化到本地存储。
 */
import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, type ReactNode } from 'react';
import { storage, StorageKeys } from '@/data/db/storage';
import {
  getColors,
  DarkColors,
  type ColorScheme,
  type ThemeMode,
  type UpDownScheme,
} from './index';

interface ThemeCtx {
  mode: ThemeMode;
  upDownScheme: UpDownScheme;
  colors: ColorScheme;
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
  setUpDownScheme: (s: UpDownScheme) => void;
}

const Ctx = createContext<ThemeCtx>({
  mode: 'dark',
  upDownScheme: 'cn',
  colors: DarkColors,
  toggle: () => {},
  setMode: () => {},
  setUpDownScheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [mode, setModeState] = useState<ThemeMode>('dark');
  const [upDownScheme, setScheme] = useState<UpDownScheme>('cn');

  useEffect(() => {
    storage.getString(StorageKeys.THEME_MODE).then((v) => {
      if (v === 'light' || v === 'dark') setModeState(v);
    });
    storage.getString(StorageKeys.UPDOWN_SCHEME).then((v) => {
      if (v === 'cn' || v === 'intl' || v === 'colorblind') setScheme(v);
    });
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    storage.setString(StorageKeys.THEME_MODE, m);
  }, []);
  const setUpDownScheme = useCallback((s: UpDownScheme) => {
    setScheme(s);
    storage.setString(StorageKeys.UPDOWN_SCHEME, s);
  }, []);
  const toggle = useCallback(() => setMode(mode === 'dark' ? 'light' : 'dark'), [mode, setMode]);

  const value = useMemo<ThemeCtx>(
    () => ({
      mode,
      upDownScheme,
      colors: getColors(mode, upDownScheme),
      toggle,
      setMode,
      setUpDownScheme,
    }),
    [mode, upDownScheme, toggle, setMode, setUpDownScheme],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppTheme(): ThemeCtx {
  return useContext(Ctx);
}
