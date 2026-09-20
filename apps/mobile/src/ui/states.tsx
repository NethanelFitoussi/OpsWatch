/**
 * Loading, error, empty and "not available on this server" states, plus the freshness line and the offline and demo
 * banners. Stale data is always labelled with its age; it is never presented as live.
 */
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isApiError } from '@/api/errors';
import { useI18n, type MessageKey } from '@/i18n';
import { formatRelative } from '@/lib/format';
import { useFeature, useSession } from '@/state/session';
import type { Feature } from '@/api/contract';
import { Button } from './controls';
import type { IconName } from './layout';
import { Text } from './text';
import { radius, spacing } from './theme';
import { useTheme } from './theme-provider';

/** Current time, re-rendered every `intervalMs` so relative times ("3 min ago") stay honest. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((state) => setOnline(state.isConnected !== false && state.isInternetReachable !== false)), []);
  return online;
}

export function useRelativeTime() {
  const { t } = useI18n();
  return (at: number, now: number) =>
    formatRelative(at, now, { now: t('time.justNow'), ago: (amount) => t('time.ago', { amount }), in: (amount) => t('time.in', { amount }) });
}

export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label ?? t('state.loading')}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text tone="muted">{label ?? t('state.loading')}</Text>
    </View>
  );
}

export function errorMessageKey(error: unknown): MessageKey {
  return isApiError(error) ? (`error.${error.kind}` as MessageKey) : 'error.network';
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const action = isApiError(error) ? error.action : undefined;
  return (
    <View style={compact ? styles.compact : styles.center} accessibilityLiveRegion="polite" testID="error-state">
      <Ionicons name="cloud-offline-outline" size={compact ? 22 : 40} color={colors.textFaint} importantForAccessibility="no" />
      <Text variant={compact ? 'small' : 'subtitle'} style={styles.centerText}>
        {t(errorMessageKey(error))}
      </Text>
      {action ? (
        <Text variant="mono" tone="muted" style={styles.centerText}>
          {action}
        </Text>
      ) : null}
      {onRetry ? <Button label={t('action.retry')} onPress={onRetry} variant="secondary" icon="refresh" compact /> : null}
    </View>
  );
}

export function EmptyState({ title, body, icon = 'checkmark-done-outline', action }: { title: string; body?: string; icon?: IconName; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.center} testID="empty-state">
      <Ionicons name={icon} size={40} color={colors.textFaint} importantForAccessibility="no" />
      <Text variant="subtitle" style={styles.centerText}>
        {title}
      </Text>
      {body ? (
        <Text tone="muted" style={styles.centerText}>
          {body}
        </Text>
      ) : null}
      {action}
    </View>
  );
}

/** Renders children only when the server advertises the feature; otherwise explains that it is not there yet. */
export function FeatureGate({ feature, label, children }: { feature: Feature; label: string; children: ReactNode }) {
  const { t } = useI18n();
  const available = useFeature(feature);
  if (available) return <>{children}</>;
  return <EmptyState icon="construct-outline" title={t('state.featureUnavailableTitle')} body={t('state.featureUnavailableBody', { feature: label })} />;
}

/**
 * "Updated 3 min ago", plus a banner when the device is offline or the last refresh failed while cached data is shown.
 * `updatedAt` is the time the data was fetched (React Query's dataUpdatedAt), not when the server generated it.
 */
export function Freshness({ updatedAt, refreshFailed, fetching }: { updatedAt: number; refreshFailed?: boolean; fetching?: boolean }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const now = useNow(15_000);
  const online = useOnline();
  const relative = useRelativeTime();
  if (!updatedAt) return null;
  const age = relative(updatedAt, now);
  const stale = !online || refreshFailed;
  if (stale) {
    return (
      <View style={[styles.banner, { backgroundColor: colors.warningBg }]} accessibilityLiveRegion="polite" testID="stale-banner">
        <Ionicons name={online ? 'time-outline' : 'cloud-offline-outline'} size={16} color={colors.warning} importantForAccessibility="no" />
        <Text variant="small" weight="600" style={{ color: colors.warning, flex: 1 }}>
          {online ? t('state.staleRefreshFailed', { time: age }) : t('state.offline', { time: age })}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.fresh} testID="freshness">
      <Ionicons name={fetching ? 'sync-outline' : 'time-outline'} size={13} color={colors.textFaint} importantForAccessibility="no" />
      <Text variant="caption" tone="faint">
        {fetching ? t('state.refreshing') : now - updatedAt < 45_000 ? t('state.updatedJustNow') : t('state.updatedAgo', { time: age })}
      </Text>
    </View>
  );
}

/** Whether the demo banner is showing: the app layout then stops the header from insetting the status bar twice. */
export function useDemoBannerShown(): boolean {
  const { state } = useSession();
  return state.status === 'signed-in' && (state.server.demo || state.server.info?.demo === true);
}

/**
 * Sits above everything, so it covers the status bar area itself: its own top padding is the safe-area inset, which
 * keeps the clock and battery readable over the banner's background.
 */
export function DemoBanner() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (!useDemoBannerShown()) return null;
  return (
    <View
      style={[styles.demo, { backgroundColor: colors.demoBg, paddingTop: insets.top + 5 }]}
      accessibilityRole="text"
      testID="demo-banner"
    >
      <Ionicons name="flask" size={14} color={colors.demo} importantForAccessibility="no" />
      <Text variant="caption" weight="700" style={{ color: colors.demo }} numberOfLines={1} adjustsFontSizeToFit>
        {t('state.demoBanner')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md, minHeight: 240 },
  compact: { alignItems: 'center', padding: spacing.lg, gap: spacing.sm },
  centerText: { textAlign: 'center', maxWidth: 420 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  fresh: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.xs },
  demo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: spacing.md },
});
