/**
 * Test helpers: render a component inside every provider the app uses, with the demo client and settings that do not
 * touch storage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { buildDemoDataset, DEMO_CREDENTIALS } from '@/demo/fixtures';
import { I18nProvider, type Locale } from '@/i18n';
import { DEMO_SERVER_URL, SessionProvider } from '@/state/session';
import { SettingsProvider, type Settings } from '@/state/settings';
import { PREF_KEYS } from '@/state/storage';
import { ThemeProvider } from '@/ui/theme-provider';

export function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
}

export function TestProviders({ children, locale = 'en', settings, queryClient }: { children: ReactNode; locale?: Locale; settings?: Partial<Settings>; queryClient?: QueryClient }) {
  const client = queryClient ?? createTestQueryClient();
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <SettingsProvider initial={settings ?? {}}>
        <I18nProvider locale={locale}>
          <ThemeProvider mode="light">
            <SessionProvider locale={locale}>
              <QueryClientProvider client={client}>{children}</QueryClientProvider>
            </SessionProvider>
          </ThemeProvider>
        </I18nProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

export function renderWithProviders(ui: ReactElement, options: RenderOptions & { locale?: Locale; settings?: Partial<Settings> } = {}) {
  const { locale, settings, ...rest } = options;
  return render(ui, { wrapper: ({ children }) => <TestProviders locale={locale} settings={settings}>{children}</TestProviders>, ...rest });
}

/** Stores a signed-in demo session so the SessionProvider starts signed in (demo client, no network). */
export async function seedDemoSession(): Promise<void> {
  await AsyncStorage.setItem(
    PREF_KEYS.server,
    JSON.stringify({ url: DEMO_SERVER_URL, demo: true, insecure: false, info: buildDemoDataset().server, user: { email: DEMO_CREDENTIALS.email } }),
  );
}
