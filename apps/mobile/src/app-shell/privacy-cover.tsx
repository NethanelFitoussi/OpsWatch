/**
 * Covers the app when it leaves the foreground, so the app switcher snapshot does not show production data.
 * Controlled by the "Hide content in the app switcher" setting (on by default).
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { useI18n } from '@/i18n';
import { useSettings } from '@/state/settings';
import { Text } from '@/ui/text';
import { useTheme } from '@/ui/theme-provider';

export function PrivacyCover() {
  const { settings } = useSettings();
  const { colors } = useTheme();
  const { t } = useI18n();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web' || !settings.privacyCover) return;
    // iOS takes the snapshot during `inactive`; Android during `background`.
    const subscription = AppState.addEventListener('change', (status) => setHidden(status !== 'active'));
    return () => subscription.remove();
  }, [settings.privacyCover]);

  if (!hidden) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: colors.background }]} accessibilityLabel={t('a11y.privacyCover')}>
      <Ionicons name="pulse" size={56} color={colors.primary} />
      <Text variant="title">OpsWatch</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { alignItems: 'center', justifyContent: 'center', gap: 12, zIndex: 1000 },
});
