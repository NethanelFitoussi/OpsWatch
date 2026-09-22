/**
 * Loading, error, empty and "not available on this server" states, plus the freshness line and the offline and demo
 * banners. Stale data is always labelled with its age; it is never presented as live.
 *
 * Two rules drive this file:
 * - An error says what happened and what to do next, and only offers "Try again" when trying again can work.
 * - Data older than a glance is never shown without a visible warning, and a screen with nothing cached says so.
 */
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isApiError, type ApiErrorKind } from '@/api/errors';
import { useI18n, type MessageKey } from '@/i18n';
import { formatAge, formatDuration } from '@/lib/format';
import { useSession } from '@/state/session';
import type { Feature } from '@/api/contract';
import { Button } from './controls';
import type { IconName } from './layout';
import { Text } from './text';
import { radius, spacing } from './theme';
import { useTheme } from './theme-provider';

/** Before this, a spinner is just a flash: a fast answer should never blink at the user. */
export const SPINNER_DELAY_MS = 200;
/** Past this age, "Updated 12 min ago" is not enough: the screen says out loud that what it shows is not live. */
export const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * One clock for the whole app.
 *
 * Every row that says "3 min ago" needs the time to move, and a list can hold fifty of them. A timer per component
 * would mean fifty wakeups, fifty re-renders and staggered updates, so they share a single interval: subscribers are
 * notified together, and each reads the time rounded to the granularity it asked for, so a component that only cares
 * about minutes does not re-render when the seconds change. The interval runs only while the app is in front —
 * nothing on screen needs updating while it is in the background.
 */
const CLOCK_TICK_MS = 15_000;

const clock = (() => {
  const listeners = new Set<() => void>();
  let now = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  let appState: { remove: () => void } | null = null;

  const tick = () => {
    now = Date.now();
    listeners.forEach((listener) => listener());
  };
  const start = () => {
    if (timer === null) timer = setInterval(tick, CLOCK_TICK_MS);
  };
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  return {
    now: () => now,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        start();
        if (Platform.OS !== 'web') {
          appState = AppState.addEventListener('change', (status) => {
            if (status === 'active') {
              tick();
              start();
            } else {
              stop();
            }
          });
        }
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stop();
          appState?.remove();
          appState = null;
        }
      };
    },
  };
})();

/**
 * Current time, rounded to `intervalMs`, so relative times stay honest without a timer per component. It rounds
 * *up*: an age computed from it is never shorter than the real one, so data can never look fresher than it is.
 */
export function useNow(intervalMs = 30_000): number {
  const snapshot = useCallback(() => Math.ceil(clock.now() / intervalMs) * intervalMs, [intervalMs]);
  return useSyncExternalStore(clock.subscribe, snapshot, snapshot);
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((state) => setOnline(state.isConnected !== false && state.isInternetReachable !== false)), []);
  return online;
}

/** False until `ms` has passed, so a spinner can be held back over a response that may well arrive first. */
export function useDelayed(ms: number): boolean {
  const [elapsed, setElapsed] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) return;
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return elapsed;
}

/**
 * Relative time for the screens. Every timestamp they show is a past event, so this never renders the future — see
 * `formatAge`. The `in` label is still supplied: it is part of the formatter's contract, and keeping it means a
 * future-facing caller would read correctly rather than silently saying "just now".
 */
export function useRelativeTime() {
  const { t } = useI18n();
  return (at: number, now: number) =>
    formatAge(at, now, { now: t('time.justNow'), ago: (amount) => t('time.ago', { amount }), in: (amount) => t('time.in', { amount }) });
}

/**
 * The spinner is held back for `delayMs`, so a quick response replaces an empty area rather than a flash of
 * "Loading…". The reserved box keeps the layout from jumping when the spinner does appear.
 */
export function LoadingState({ label, delayMs = SPINNER_DELAY_MS }: { label?: string; delayMs?: number }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const show = useDelayed(delayMs);
  if (!show) return <View style={styles.center} testID="loading-placeholder" />;
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label ?? t('state.loading')} testID="loading-state">
      <ActivityIndicator color={colors.primary} size="large" />
      <Text tone="muted">{label ?? t('state.loading')}</Text>
    </View>
  );
}

export function errorMessageKey(error: unknown): MessageKey {
  return isApiError(error) ? (`error.${error.kind}` as MessageKey) : 'error.unexpected';
}

/** Repeating the request can only help for these; anywhere else "Try again" would simply fail again. */
const RETRYABLE: ReadonlySet<ApiErrorKind> = new Set<ApiErrorKind>(['network', 'timeout', 'rate_limited', 'server', 'invalid_response', 'cancelled']);

export function canRetry(error: unknown): boolean {
  return isApiError(error) ? RETRYABLE.has(error.kind) : true;
}

const ERROR_ICONS: Record<ApiErrorKind, IconName> = {
  network: 'cloud-offline-outline',
  timeout: 'time-outline',
  unauthorized: 'lock-closed-outline',
  forbidden: 'lock-closed-outline',
  not_found: 'help-circle-outline',
  rate_limited: 'hourglass-outline',
  validation: 'alert-circle-outline',
  server: 'server-outline',
  invalid_response: 'warning-outline',
  unsupported: 'construct-outline',
  cancelled: 'close-circle-outline',
};

/**
 * The second line: what to do about it. One short sentence, omitted when the message above already says everything
 * there is to say.
 */
function useErrorHint(error: unknown): string | null {
  const { t } = useI18n();
  if (!isApiError(error)) return null;
  switch (error.kind) {
    case 'rate_limited':
      return error.retryAfterMs ? t('error.hint.retryAfter', { time: formatDuration(error.retryAfterMs) }) : null;
    case 'invalid_response':
      return t('error.hint.checkAddress');
    case 'forbidden':
      return t('error.hint.forbidden');
    case 'not_found':
      return t('error.hint.notFound');
    case 'unsupported':
      return t('error.hint.unsupported');
    case 'server':
      return t('error.hint.server');
    case 'timeout':
      return t('error.hint.timeout');
    default:
      return null;
  }
}

/**
 * Every failure the user can meet, in one sentence plus one piece of advice. "Try again" appears only when
 * repeating the request could succeed; a missing provider permission is shown exactly as the server named it, so it
 * can be read out or pasted into a policy.
 */
export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const hint = useErrorHint(error);
  const kind = isApiError(error) ? error.kind : null;
  const action = isApiError(error) ? error.action : undefined;
  // Nothing cached and no connection: that is the whole story, and it is not the server's fault.
  const offline = !online && (kind === null || kind === 'network' || kind === 'timeout');
  const message = offline ? t('state.offlineNoData') : t(errorMessageKey(error));
  const advice = offline ? t('state.offlineNoDataBody') : hint;
  const icon: IconName = offline ? 'cloud-offline-outline' : kind ? ERROR_ICONS[kind] : 'alert-circle-outline';
  return (
    <View style={compact ? styles.compact : styles.center} accessibilityLiveRegion="polite" testID="error-state">
      <Ionicons name={icon} size={compact ? 22 : 40} color={colors.textFaint} importantForAccessibility="no" />
      <Text variant={compact ? 'small' : 'subtitle'} style={styles.centerText}>
        {message}
      </Text>
      {advice ? (
        <Text variant="small" tone="muted" style={styles.centerText}>
          {advice}
        </Text>
      ) : null}
      {action ? (
        <View style={styles.permission} testID="error-permission">
          <Text variant="caption" tone="faint" style={styles.centerText}>
            {t('error.hint.permission')}
          </Text>
          <Text variant="mono" tone="muted" style={styles.centerText} selectable>
            {action}
          </Text>
        </View>
      ) : null}
      {onRetry && (offline || canRetry(error)) ? (
        <Button label={t('action.retry')} onPress={onRetry} variant="secondary" icon="refresh" compact testID="error-retry" />
      ) : null}
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

/**
 * What this server says about one capability.
 * - `available`: the server advertises it.
 * - `unavailable`: the server answered and does not have it. Not an error, and nothing to retry.
 * - `unknown`: no capabilities were read at all (an older server, or `GET /server` never succeeded). The app must
 *   not guess: a feature it cannot confirm is never presented as working.
 */
export type FeatureStatus = 'available' | 'unavailable' | 'unknown';

export function useFeatureStatus(feature: Feature): FeatureStatus {
  const { state } = useSession();
  const info = state.status === 'signed-in' || state.status === 'signed-out' ? state.server.info : null;
  if (!info) return 'unknown';
  return info.features[feature] ? 'available' : 'unavailable';
}

/**
 * Renders children only when the server advertises the feature. Otherwise it says which of the two things happened —
 * this server does not provide it, or the app could not find out — and makes clear that neither breaks the rest of
 * the app. Only the second case is worth retrying.
 */
export function FeatureGate({ feature, label, children }: { feature: Feature; label: string; children: ReactNode }) {
  const { t } = useI18n();
  const { refreshServerInfo } = useSession();
  const status = useFeatureStatus(feature);
  if (status === 'available') return <>{children}</>;
  if (status === 'unknown') {
    return (
      <View style={styles.gate} testID="feature-unknown">
        <EmptyState
          icon="help-circle-outline"
          title={t('state.featureUnknownTitle')}
          body={t('state.featureUnknownBody', { feature: label })}
          action={<Button label={t('action.retry')} onPress={() => void refreshServerInfo()} variant="secondary" icon="refresh" compact testID="feature-unknown-retry" />}
        />
      </View>
    );
  }
  return (
    <View style={styles.gate} testID="feature-unavailable">
      <EmptyState icon="construct-outline" title={t('state.featureUnavailableFor', { feature: label })} body={t('state.featureUnavailableBody', { feature: label })} />
    </View>
  );
}

function Banner({ icon, text, onRetry, testID }: { icon: IconName; text: string; onRetry?: () => void; testID: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View style={[styles.banner, { backgroundColor: colors.warningBg }]} accessibilityLiveRegion="polite" testID={testID}>
      <Ionicons name={icon} size={16} color={colors.warning} importantForAccessibility="no" />
      <Text variant="small" weight="600" style={{ color: colors.warning, flex: 1 }}>
        {text}
      </Text>
      {onRetry ? <Button label={t('action.retry')} onPress={onRetry} variant="secondary" compact testID={`${testID}-retry`} /> : null}
    </View>
  );
}

/**
 * "Updated 3 min ago", and a warning whenever what is on screen is not live: the device is offline, the last refresh
 * failed, or the data has simply aged past a glance. `updatedAt` is when the data was fetched (React Query's
 * dataUpdatedAt), not when the server generated it.
 */
export function Freshness({ updatedAt, refreshFailed, fetching, onRetry }: { updatedAt: number; refreshFailed?: boolean; fetching?: boolean; onRetry?: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const now = useNow(15_000);
  const online = useOnline();
  const relative = useRelativeTime();
  if (!updatedAt) return null;
  const age = relative(updatedAt, now);
  if (!online) return <Banner icon="cloud-offline-outline" text={t('state.offline', { time: age })} onRetry={onRetry} testID="stale-banner" />;
  if (refreshFailed) return <Banner icon="alert-circle-outline" text={t('state.staleRefreshFailed', { time: age })} onRetry={onRetry} testID="stale-banner" />;
  if (!fetching && now - updatedAt > STALE_AFTER_MS) return <Banner icon="time-outline" text={t('state.notLive', { time: age })} onRetry={onRetry} testID="stale-banner" />;
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
  permission: { alignItems: 'center', gap: 2 },
  gate: { flex: 1 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  fresh: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.xs },
  demo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: spacing.md },
});
