import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryProvider } from '@/api/query-provider';
import { detectLocale, I18nProvider, type Locale } from '@/i18n';
import { SessionProvider } from '@/state/session';
import { SettingsProvider, useSettings } from '@/state/settings';
import { ThemeProvider, useTheme } from '@/ui/theme-provider';

function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

function WithSettings({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const locale: Locale = settings.locale === 'system' ? detectLocale() : settings.locale;
  return (
    <I18nProvider locale={locale}>
      <ThemeProvider mode={settings.themeMode}>
        <ThemedStatusBar />
        <SessionProvider locale={locale}>
          <QueryProvider>{children}</QueryProvider>
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <WithSettings>{children}</WithSettings>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
