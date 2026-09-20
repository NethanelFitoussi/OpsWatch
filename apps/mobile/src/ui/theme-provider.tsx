import * as SystemUI from 'expo-system-ui';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { palettes, type ColorSchemeName, type Palette } from './theme';
import type { ThemeMode } from '@/state/settings';

type ThemeValue = { scheme: ColorSchemeName; colors: Palette };

const ThemeContext = createContext<ThemeValue>({ scheme: 'light', colors: palettes.light });

export function resolveScheme(mode: ThemeMode, system: string | null | undefined): ColorSchemeName {
  if (mode === 'light' || mode === 'dark') return mode;
  return system === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ mode, children }: { mode: ThemeMode; children: ReactNode }) {
  const system = useColorScheme();
  const scheme = resolveScheme(mode, system);
  const value = useMemo(() => ({ scheme, colors: palettes[scheme] }), [scheme]);

  // The native root view keeps the theme's background, so switching to dark mode or launching into it never shows a
  // white flash behind the React tree.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(value.colors.background).catch(() => undefined);
  }, [value.colors.background]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}
