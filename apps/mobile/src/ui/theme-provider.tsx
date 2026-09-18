import { createContext, useContext, useMemo, type ReactNode } from 'react';
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
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}
