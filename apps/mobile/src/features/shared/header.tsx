/**
 * Header accessories: the environment pill (production is unmistakable) and the search shortcut.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Environment } from '@/api/contract';
import { useEnvironments } from '@/api/queries';
import { useI18n } from '@/i18n';
import { useFeature } from '@/state/session';
import { useSettings } from '@/state/settings';
import { EnvironmentBadge } from '@/ui/badges';
import { spacing } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';

export function useCurrentEnvironment(): Environment | null {
  const { settings } = useSettings();
  const environments = useEnvironments();
  const list = environments.data ?? [];
  return list.find((e) => e.id === settings.environmentId) ?? list.find((e) => e.kind === 'production') ?? list[0] ?? null;
}

export function EnvironmentPill() {
  const router = useRouter();
  const { t } = useI18n();
  const environment = useCurrentEnvironment();
  const enabled = useFeature('environments');
  if (!enabled || !environment) return null;
  return (
    <Pressable
      onPress={() => router.push('/settings/environment')}
      accessibilityRole="button"
      accessibilityLabel={`${t('env.current', { name: environment.name })}. ${t('env.switch')}`}
      hitSlop={8}
      testID="environment-pill"
    >
      <EnvironmentBadge environment={environment} />
    </Pressable>
  );
}

export function HeaderActions() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View style={styles.actions}>
      <EnvironmentPill />
      <Pressable onPress={() => router.push('/search')} accessibilityRole="button" accessibilityLabel={t('nav.search')} hitSlop={10} style={styles.icon} testID="open-search">
        <Ionicons name="search" size={22} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingRight: spacing.sm },
  icon: { padding: 4 },
});
