import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { View } from 'react-native';
import { AppErrorBoundary } from '@/app-shell/error-boundary';
import { AppProviders } from '@/app-shell/providers';
import { NotificationEffects } from '@/app-shell/notification-effects';
import { PrivacyCover } from '@/app-shell/privacy-cover';
import { SessionEffects } from '@/app-shell/session-effects';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/ui/theme-provider';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function RootNavigator() {
  const { state } = useSession();
  const { loaded } = useSettings();
  const { colors } = useTheme();
  const ready = loaded && state.status !== 'loading';

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  const signedIn = state.status === 'signed-in';

  return (
    <>
      <AppErrorBoundary>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
          <Stack.Screen name="auth/callback" />
        </Stack>
      </AppErrorBoundary>
      <SessionEffects />
      <NotificationEffects />
      <PrivacyCover />
    </>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}
