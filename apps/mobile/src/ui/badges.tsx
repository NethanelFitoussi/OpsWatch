/**
 * Status, severity and environment badges. Each one shows an icon AND a word, so status never depends on colour.
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import type { Environment, HealthStatus, Severity } from '@/api/contract';
import { useI18n } from '@/i18n';
import type { IconName } from './layout';
import { Text } from './text';
import { radius, spacing, toneColors, toneForHealth, toneForSeverity, type Tone } from './theme';
import { useTheme } from './theme-provider';

export const TONE_ICONS: Record<Tone, IconName> = {
  critical: 'alert-circle',
  warning: 'warning',
  healthy: 'checkmark-circle',
  info: 'information-circle',
  unknown: 'help-circle',
};

export function Badge({ tone, label, icon, size = 'small', testID }: { tone: Tone; label: string; icon?: IconName; size?: 'small' | 'large'; testID?: string }) {
  const { colors } = useTheme();
  const { fg, bg } = toneColors(colors, tone);
  const large = size === 'large';
  return (
    <View style={[styles.badge, { backgroundColor: bg }, large && styles.large]} accessible accessibilityLabel={label} testID={testID}>
      <Ionicons name={icon ?? TONE_ICONS[tone]} size={large ? 18 : 13} color={fg} importantForAccessibility="no" />
      <Text variant={large ? 'body' : 'caption'} weight="700" style={{ color: fg }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function HealthBadge({ status, size }: { status: HealthStatus; size?: 'small' | 'large' }) {
  const { t } = useI18n();
  return <Badge tone={toneForHealth(status)} label={t(`health.${status}`)} size={size} />;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { t } = useI18n();
  return <Badge tone={toneForSeverity(severity)} label={t(`severity.${severity}`)} />;
}

/** A neutral badge for workflow states (new, acknowledged…). */
export function StateBadge({ label, icon }: { label: string; icon?: IconName }) {
  return <Badge tone="unknown" label={label} icon={icon ?? 'ellipse-outline'} />;
}

/** Production is loud on purpose, so nobody mistakes it for staging. */
export function EnvironmentBadge({ environment }: { environment: Pick<Environment, 'name' | 'kind'> }) {
  const { colors } = useTheme();
  const production = environment.kind === 'production';
  const fg = production ? colors.production : colors.textMuted;
  const bg = production ? colors.productionBg : colors.surfaceAlt;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]} accessible accessibilityLabel={environment.name} testID="environment-badge">
      <Ionicons name={production ? 'flame' : 'flask-outline'} size={13} color={fg} importantForAccessibility="no" />
      <Text variant="caption" weight="700" style={{ color: fg }} numberOfLines={1}>
        {production ? environment.name.toUpperCase() : environment.name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  large: { paddingHorizontal: spacing.md, paddingVertical: 6, gap: 6 },
});
