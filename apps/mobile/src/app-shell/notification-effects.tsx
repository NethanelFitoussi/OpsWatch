/**
 * Notification wiring:
 * - foreground presentation filtered by the user's preferences;
 * - Android channel with private lock-screen visibility (content hidden on a locked screen);
 * - taps (warm and cold start) routed through the allow-list, or remembered until sign-in;
 * - device registration with the server when push is enabled on both sides, unregistration when a session ends.
 *
 * Remote push needs an EAS project id plus APNs/FCM credentials (docs/mobile/notifications.md). Without them the app
 * still handles local notifications and taps, and says why registration is unavailable.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { OpsWatchClient } from '@/api/client';
import type { NotificationPreferences } from '@/api/contract';
import { log } from '@/lib/log';
import { categoryOf, dedupeKey, isRepeat, parseNotificationData, routeForNotification, shouldPresent } from '@/lib/notifications';
import { pendingLink } from '@/state/pending-link';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { prefs, PREF_KEYS } from '@/state/storage';

export const ANDROID_CHANNEL = 'opswatch-alerts';
const isWeb = Platform.OS === 'web';

let currentPrefs: NotificationPreferences | null = null;

/** Read by the module-level notification handler, which lives outside React. */
function setPresentationPreferences(preferences: NotificationPreferences): void {
  currentPrefs = preferences;
}

if (!isWeb) {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      const category = categoryOf(data?.category);
      const severity = data?.severity === 'critical' || data?.severity === 'warning' || data?.severity === 'info' ? data.severity : undefined;
      const duplicate = isRepeat(`show:${dedupeKey(data, notification.request.identifier)}`, Date.now());
      const show = !duplicate && (!currentPrefs || !category || shouldPresent(currentPrefs, { category, severity }));
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show && severity === 'critical', shouldSetBadge: false };
    },
  });
}

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
    name: 'OpsWatch alerts',
    importance: Notifications.AndroidImportance.HIGH,
    // The locked screen shows "OpsWatch" and a generic line, not the notification text.
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

export type RegistrationResult = { ok: true } | { ok: false; reason: 'web' | 'not_device' | 'denied' | 'no_project' | 'server_unsupported' | 'failed' };

/** What the server was last told, so the app only re-registers when something it cares about actually changed. */
type StoredRegistration = { id: string; pushToken: string; server: string; preferences: string };

export async function registerForPush(
  client: OpsWatchClient,
  preferences: NotificationPreferences,
  serverUrl = '',
): Promise<RegistrationResult> {
  if (isWeb) return { ok: false, reason: 'web' };
  if (!Device.isDevice) return { ok: false, reason: 'not_device' };
  await ensureAndroidChannel();
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return { ok: false, reason: 'denied' };
  const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
  if (!projectId) return { ok: false, reason: 'no_project' };
  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    const stored = await prefs.get<StoredRegistration | null>(PREF_KEYS.deviceRegistration, null);
    const wanted = { pushToken: token.data, server: serverUrl, preferences: JSON.stringify(preferences) };
    // The push token rotates, the preferences change, and the user can move to another server: any of those means
    // the server's record is stale. Nothing else is worth another round trip.
    if (stored && stored.pushToken === wanted.pushToken && stored.server === wanted.server && stored.preferences === wanted.preferences) {
      return { ok: true };
    }
    const registration = await client.registerDevice({ pushToken: token.data, platform: Platform.OS === 'ios' ? 'ios' : 'android', preferences });
    await prefs.set(PREF_KEYS.deviceRegistration, { id: registration.id, ...wanted } satisfies StoredRegistration);
    return { ok: true };
  } catch (error) {
    log.warn('Push registration failed', error);
    return { ok: false, reason: (error as { kind?: string }).kind === 'unsupported' ? 'server_unsupported' : 'failed' };
  }
}

export async function unregisterFromPush(client: OpsWatchClient): Promise<void> {
  const stored = await prefs.get<StoredRegistration | null>(PREF_KEYS.deviceRegistration, null);
  if (!stored?.id) return;
  // Forgotten locally first: a failed call must not leave the app believing it is still registered.
  await prefs.remove(PREF_KEYS.deviceRegistration);
  await client.unregisterDevice(stored.id).catch((error: unknown) => log.debug('Push unregistration failed', error));
}

export function NotificationEffects() {
  const router = useRouter();
  const { state, client, onSessionEnd } = useSession();
  const { settings, update } = useSettings();
  const updateRef = useRef(update);
  const signedIn = state.status === 'signed-in';
  const signedInRef = useRef(signedIn);
  const clientRef = useRef(client);
  useEffect(() => {
    signedInRef.current = signedIn;
    clientRef.current = client;
    updateRef.current = update;
    setPresentationPreferences(settings.notifications);
  }, [signedIn, client, update, settings.notifications]);

  // Taps, including the one that cold-started the app.
  useEffect(() => {
    if (isWeb) return;
    void ensureAndroidChannel().catch(() => undefined);
    const open = (data: unknown) => {
      const route = routeForNotification(data);
      if (!route) return;
      // The same tap can be delivered twice (a cold start also replays the last response); open one screen only.
      if (isRepeat(`open:${dedupeKey(data, route)}`, Date.now())) return;
      // A notification belongs to one environment. Switching to it first means the object being opened is the one
      // the notification was about, rather than a stranger with the same id in whatever environment was selected.
      const target = parseNotificationData(data);
      if (target?.env) updateRef.current({ environmentId: target.env });
      if (signedInRef.current) router.push(route as Href);
      else pendingLink.set(route);
    };
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(response.notification.request.content.data);
    });
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => open(response.notification.request.content.data));
    return () => subscription.remove();
  }, [router]);

  // Unregister this device once the session has ended, through a client that still holds the old token.
  useEffect(() => onSessionEnd((_reason, revoker) => (revoker ? unregisterFromPush(revoker) : undefined)), [onSessionEnd]);

  // Keep the server registration in step with the preferences. Keyed on their content, not the object identity, so
  // toggling one category does not re-register the device on every keystroke of state.
  const pushSupported = signedIn && !state.server.demo && state.server.info?.features.push === true;
  const serverUrl = state.status === 'signed-in' ? state.server.url : '';
  const preferencesKey = JSON.stringify(settings.notifications);
  useEffect(() => {
    const preferences = JSON.parse(preferencesKey) as NotificationPreferences & { enabled: boolean };
    if (!pushSupported || !preferences.enabled) return;
    void registerForPush(clientRef.current, preferences, serverUrl);
  }, [pushSupported, preferencesKey, serverUrl]);

  return null;
}
