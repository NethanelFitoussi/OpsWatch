/**
 * Test helpers: render a component inside every provider the app uses, with the demo client and settings that do not
 * touch storage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, type RenderOptions } from '@testing-library/react-native';
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

/**
 * Renders inside every provider, and waits for the session provider to finish restoring from storage.
 *
 * That restore is an async effect, so without the wait its `setState` lands after the test body has returned: React
 * reports it as an update not wrapped in `act`. Those warnings were harmless here, but a run that always prints them
 * teaches everyone to ignore the one that is not. Awaiting it is also what the app really does, so a test that asserts
 * straight after rendering is asserting on the state the user would see.
 */
export async function renderWithProviders(ui: ReactElement, options: RenderOptions & { locale?: Locale; settings?: Partial<Settings> } = {}) {
  const { locale, settings, ...rest } = options;
  const result = render(ui, { wrapper: ({ children }) => <TestProviders locale={locale} settings={settings}>{children}</TestProviders>, ...rest });
  await act(async () => {
    await Promise.resolve();
  });
  return result;
}

/** Stores a signed-in demo session so the SessionProvider starts signed in (demo client, no network). */
export async function seedDemoSession(): Promise<void> {
  await AsyncStorage.setItem(
    PREF_KEYS.server,
    JSON.stringify({ url: DEMO_SERVER_URL, demo: true, insecure: false, info: buildDemoDataset().server, user: { email: DEMO_CREDENTIALS.email } }),
  );
}
