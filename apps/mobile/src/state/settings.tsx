/**
 * Local, non-sensitive preferences. Loaded once at startup; every change is written back to AsyncStorage.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Favorite, Feature, NotificationPreferences } from '@/api/contract';
import { NOTIFICATION_CATEGORIES } from '@/api/contract';
import { prefs, PREF_KEYS } from './storage';

export type ThemeMode = 'system' | 'light' | 'dark';
export type LocalePreference = 'system' | 'en' | 'fr';

export type Settings = {
  themeMode: ThemeMode;
  locale: LocalePreference;
  /** Selected environment id; null means the server's default environment. */
  environmentId: string | null;
  privacyCover: boolean;
  notifications: NotificationPreferences & { enabled: boolean };
  recentSearches: string[];
  /** Used only while the server does not support favorites (`features.favorites` false). */
  localFavorites: Favorite[];
  /**
   * Demo mode only: capabilities switched off by hand, so a contributor can see how the app behaves against a
   * server that lacks them. Ignored for a real server, whose `GET /server` is the only source of truth.
   */
  demoCapabilities: Partial<Record<Feature, boolean>>;
};

export const DEFAULT_SETTINGS: Settings = {
  themeMode: 'system',
  locale: 'system',
  environmentId: null,
  privacyCover: true,
  notifications: { enabled: false, minSeverity: 'critical', categories: [...NOTIFICATION_CATEGORIES] },
  recentSearches: [],
  localFavorites: [],
  demoCapabilities: {},
};

export const MAX_RECENT_SEARCHES = 8;

type SettingsContextValue = {
  settings: Settings;
  loaded: boolean;
  update: (patch: Partial<Settings> | ((current: Settings) => Partial<Settings>)) => void;
  /** Forgets everything tied to one server: environment, favorites, recent searches. */
  resetServerScoped: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children, initial }: { children: ReactNode; initial?: Partial<Settings> }) {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS, ...initial });
  const [loaded, setLoaded] = useState(initial !== undefined);

  useEffect(() => {
    if (initial !== undefined) return;
    let cancelled = false;
    void prefs.get<Partial<Settings>>(PREF_KEYS.settings, {}).then((stored) => {
      if (cancelled) return;
      setSettings({ ...DEFAULT_SETTINGS, ...stored, notifications: { ...DEFAULT_SETTINGS.notifications, ...stored.notifications } });
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [initial]);

  const update = useCallback<SettingsContextValue['update']>((patch) => {
    setSettings((current) => {
      const next = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
      void prefs.set(PREF_KEYS.settings, next);
      return next;
    });
  }, []);

  const resetServerScoped = useCallback(() => {
    update({ environmentId: null, recentSearches: [], localFavorites: [] });
  }, [update]);

  const value = useMemo(() => ({ settings, loaded, update, resetServerScoped }), [settings, loaded, update, resetServerScoped]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside SettingsProvider');
  return value;
}

/** Longest query kept on the device: enough for a real search, short enough that a pasted payload is not stored. */
export const MAX_RECENT_SEARCH_LENGTH = 120;

export function addRecentSearch(list: readonly string[], text: string): string[] {
  const trimmed = text.trim().slice(0, MAX_RECENT_SEARCH_LENGTH);
  if (!trimmed) return [...list];
  return [trimmed, ...list.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_RECENT_SEARCHES);
}
