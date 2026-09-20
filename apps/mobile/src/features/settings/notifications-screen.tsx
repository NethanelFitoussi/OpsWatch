/**
 * Notification preferences. Push registration needs the server (`features.push`), a physical device, the system
 * permission and a push project in this build; each missing piece is explained instead of failing silently.
 */
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { NOTIFICATION_CATEGORIES, type NotificationCategory, type NotificationPreferences } from '@/api/contract';
import { registerForPush, unregisterFromPush, type RegistrationResult } from '@/app-shell/notification-effects';
import { useI18n } from '@/i18n';
import { log } from '@/lib/log';
import { useFeature, useSession } from '@/state/session';
import { useSettings, type Settings } from '@/state/settings';
import { Button, ChipGroup } from '@/ui/controls';
import { Card, Divider, Section } from '@/ui/layout';
import { ScrollScreen } from '@/ui/screen';
import { spacing } from '@/ui/theme';
import { Note, SwitchRow } from './components';
import { registrationMessage } from './helpers';

const isWeb = Platform.OS === 'web';

/** The only data a test notification carries: a reference the app routes through its allow-list. */
export const TEST_NOTIFICATION_DATA = { type: 'problem', id: 'prb-checkout-5xx', category: 'critical_problem', severity: 'critical' } as const;

export function NotificationsScreen() {
  const { t } = useI18n();
  const { state, client } = useSession();
  const { settings, update } = useSettings();
  const serverPush = useFeature('push');
  const demo = state.status === 'signed-in' && state.server.demo;
  const prefs = settings.notifications;
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [testStatus, setTestStatus] = useState<'sent' | 'failed' | null>(null);

  const setPrefs = (patch: Partial<Settings['notifications']>) => update((current) => ({ notifications: { ...current.notifications, ...patch } }));

  const enable = async (enabled: boolean) => {
    setPrefs({ enabled });
    setResult(null);
    if (!enabled) {
      // Tell the server to stop sending to this device, rather than only silencing it locally.
      await unregisterFromPush(client);
      return;
    }
    const preferences: NotificationPreferences = { minSeverity: prefs.minSeverity, categories: prefs.categories };
    if (serverPush && !demo) {
      setResult(await registerForPush(client, preferences));
      return;
    }
    // The server cannot push yet: still ask for the permission so local notifications (and the test) can show.
    if (isWeb) return;
    try {
      const permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) setResult({ ok: false, reason: 'denied' });
    } catch (error) {
      log.debug('Notification permission request failed', error);
    }
  };

  const toggleCategory = (category: NotificationCategory, on: boolean) =>
    setPrefs({ categories: on ? [...new Set([...prefs.categories, category])] : prefs.categories.filter((c) => c !== category) });

  const sendTest = async () => {
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title: t('notifications.testTitle'), body: t('notifications.testBody'), data: { ...TEST_NOTIFICATION_DATA } },
        trigger: null,
      });
      setTestStatus('sent');
    } catch (error) {
      log.debug('Test notification failed', error);
      setTestStatus('failed');
    }
  };

  return (
    <ScrollScreen testID="notifications-screen">
      {!serverPush ? (
        <Note tone="warning" testID="notifications-server-unsupported">
          {t('notifications.serverUnsupported')}
        </Note>
      ) : null}
      {demo ? <Note>{t('notifications.demoNote')}</Note> : null}
      {isWeb ? (
        <Note testID="notifications-web">{t('notifications.webUnsupported')}</Note>
      ) : !Device.isDevice ? (
        <Note testID="notifications-simulator">{t('notifications.notPhysicalDevice')}</Note>
      ) : null}

      <Card padded={false}>
        <SwitchRow label={t('notifications.enable')} value={prefs.enabled} onChange={(value) => void enable(value)} testID="notifications-enabled" />
      </Card>
      {result ? (
        <View style={{ gap: spacing.sm }} accessibilityLiveRegion="polite">
          <Note tone={result.ok ? 'healthy' : 'warning'} testID="notifications-result">
            {t(registrationMessage(result))}
          </Note>
          {!result.ok && result.reason === 'denied' ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <Button label={t('notifications.openSystemSettings')} icon="settings-outline" variant="secondary" compact onPress={() => void Linking.openSettings()} testID="notifications-open-settings" />
            </View>
          ) : null}
        </View>
      ) : null}

      <Section title={t('notifications.minSeverity')}>
        <View style={{ marginHorizontal: -spacing.lg }}>
          <ChipGroup<NotificationPreferences['minSeverity']>
            accessibilityLabel={t('notifications.minSeverity')}
            value={prefs.minSeverity}
            onChange={(minSeverity) => setPrefs({ minSeverity })}
            options={[
              { value: 'critical', label: t('notifications.min.critical') },
              { value: 'warning', label: t('notifications.min.warning') },
              { value: 'info', label: t('notifications.min.info') },
            ]}
          />
        </View>
      </Section>

      <Section title={t('notifications.categories')}>
        <Card padded={false}>
          {NOTIFICATION_CATEGORIES.map((category, i) => (
            <View key={category}>
              {i > 0 ? <Divider /> : null}
              <SwitchRow
                label={t(`notifications.category.${category}`)}
                value={prefs.categories.includes(category)}
                onChange={(on) => toggleCategory(category, on)}
                testID={`notifications-category-${category}`}
              />
            </View>
          ))}
        </Card>
      </Section>

      {!isWeb ? (
        <View style={{ gap: spacing.sm }}>
          <View style={{ alignSelf: 'flex-start' }}>
            <Button label={t('notifications.test')} icon="notifications-outline" variant="secondary" onPress={() => void sendTest()} testID="notifications-test" />
          </View>
          {testStatus ? (
            <Note tone={testStatus === 'sent' ? 'healthy' : 'critical'} testID="notifications-test-status">
              {t(testStatus === 'sent' ? 'notifications.testSent' : 'notifications.testFailed')}
            </Note>
          ) : null}
        </View>
      ) : null}

      <Note>{t('notifications.payloadNote')}</Note>
    </ScrollScreen>
  );
}
