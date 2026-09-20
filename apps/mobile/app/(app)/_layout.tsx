import { Stack } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import { StackHeader } from '@/ui/stack-header';
import { DemoBanner, useDemoBannerShown } from '@/ui/states';
import { useTheme } from '@/ui/theme-provider';

/**
 * Signed-in stack: the tabs, then every detail screen pushed over them. Titles are set here so deep links that land
 * directly on a detail screen still get a proper header and back button.
 */
export default function AppLayout() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const demoBannerShown = useDemoBannerShown();
  const insets = useSafeAreaInsets();
  // The banner already covers the status bar area, so everything below it starts with no top inset; otherwise the header
  // would leave a second empty strip under the banner. The stack's native header ignores this (see StackHeader), so it
  // is replaced by our own for as long as the banner is up.
  const belowBanner = demoBannerShown ? { ...insets, top: 0 } : insets;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <DemoBanner />
      <SafeAreaInsetsContext.Provider value={belowBanner}>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.primary,
            headerTitleStyle: { color: colors.text },
            contentStyle: { backgroundColor: colors.background },
            headerBackButtonDisplayMode: 'minimal',
            header: demoBannerShown ? (props) => <StackHeader {...props} /> : undefined,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="problems/[id]" options={{ title: t('tab.problems') }} />
          <Stack.Screen name="errors/index" options={{ title: t('nav.errors') }} />
          <Stack.Screen name="errors/[id]" options={{ title: t('nav.errors') }} />
          <Stack.Screen name="services/[id]" options={{ title: t('tab.services') }} />
          <Stack.Screen name="alerts/[id]" options={{ title: t('tab.alerts') }} />
          <Stack.Screen name="incidents/index" options={{ title: t('nav.incidents') }} />
          <Stack.Screen name="incidents/[id]" options={{ title: t('nav.incidents') }} />
          <Stack.Screen name="synthetics/index" options={{ title: t('nav.synthetics') }} />
          <Stack.Screen name="synthetics/[id]" options={{ title: t('nav.synthetics') }} />
          <Stack.Screen name="slos/index" options={{ title: t('nav.slos') }} />
          <Stack.Screen name="slos/[id]" options={{ title: t('nav.slos') }} />
          <Stack.Screen name="deployments/index" options={{ title: t('nav.deployments') }} />
          <Stack.Screen name="deployments/[id]" options={{ title: t('nav.deployments') }} />
          <Stack.Screen name="infrastructure/index" options={{ title: t('nav.infrastructure') }} />
          <Stack.Screen name="infrastructure/[id]" options={{ title: t('nav.infrastructure') }} />
          <Stack.Screen name="investigations/[id]" options={{ title: t('nav.investigation') }} />
          <Stack.Screen name="evidence/[id]" options={{ title: t('nav.evidence') }} />
          <Stack.Screen name="logs/index" options={{ title: t('nav.logs') }} />
          <Stack.Screen name="logs/[id]" options={{ title: t('nav.logs') }} />
          <Stack.Screen name="brief" options={{ title: t('nav.brief') }} />
          <Stack.Screen name="ask" options={{ title: t('nav.ask') }} />
          <Stack.Screen name="search" options={{ title: t('nav.search') }} />
          <Stack.Screen name="settings/index" options={{ title: t('nav.settings') }} />
          <Stack.Screen name="settings/notifications" options={{ title: t('notifications.title') }} />
          <Stack.Screen name="settings/environment" options={{ title: t('settings.environment'), presentation: 'modal' }} />
          <Stack.Screen name="settings/favorites" options={{ title: t('settings.favorites') }} />
        </Stack>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}
