/**
 * The sections of the Settings screen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { API_VERSION } from '@/api/contract';
import { useCurrentEnvironment } from '@/features/shared/header';
import { useI18n } from '@/i18n';
import { displayServer } from '@/lib/server-url';
import { useFeature, useSession } from '@/state/session';
import { useSettings, type LocalePreference, type ThemeMode } from '@/state/settings';
import { PREF_KEYS } from '@/state/storage';
import { EnvironmentBadge } from '@/ui/badges';
import { Button, ChipGroup } from '@/ui/controls';
import { Card, Divider, KeyValue, Row, Section } from '@/ui/layout';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { ConfirmCard, Note, SwitchRow } from './components';
import { buildNumberOf } from './helpers';

export const SOURCE_CODE_URL = 'https://github.com/NethanelFitoussi/OpsWatch';

type Confirming = 'sign-out' | 'change-server' | null;

export function AccountAndServerSections() {
  const { t } = useI18n();
  const session = useSession();
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [busy, setBusy] = useState(false);
  if (session.state.status !== 'signed-in') return null;
  const { server, user } = session.state;
  const address = server.demo ? t('settings.demoServer') : displayServer(server.url);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };
  return (
    <>
      <Section title={t('settings.account')}>
        <Card padded={false}>
          <Row title={user.name ?? user.email} subtitle={t('settings.signedInAs', { email: user.email })} icon="person-circle-outline" testID="settings-user" />
          <Divider />
          <Row
            title={server.demo ? t('session.leaveDemo') : t('session.signOut')}
            icon="log-out-outline"
            onPress={() => setConfirming('sign-out')}
            chevron={false}
            testID="settings-sign-out"
          />
        </Card>
        {confirming === 'sign-out' ? (
          <ConfirmCard
            message={server.demo ? t('settings.leaveDemoConfirm') : t('session.signOutConfirm', { server: address })}
            confirmLabel={server.demo ? t('session.leaveDemo') : t('session.signOut')}
            onConfirm={() => void run(session.signOut)}
            onCancel={() => setConfirming(null)}
            busy={busy}
            testID="confirm-sign-out"
          />
        ) : null}
      </Section>

      <Section title={t('settings.server')}>
        <Card>
          <KeyValue label={t('settings.serverUrl')} value={address} mono={!server.demo} />
          {server.info?.name ? <KeyValue label={t('settings.serverName')} value={server.info.name} /> : null}
          <KeyValue label={t('settings.serverVersion')} value={server.info?.version ?? t('state.noData')} />
          <KeyValue label={t('settings.serverApiVersion')} value={server.info ? String(server.info.apiVersion) : t('state.noData')} />
        </Card>
        <Card padded={false}>
          <Row title={t('settings.changeServer')} icon="swap-horizontal-outline" onPress={() => setConfirming('change-server')} chevron={false} testID="settings-change-server" />
        </Card>
        {confirming === 'change-server' ? (
          <ConfirmCard
            message={t('settings.changeServerConfirm')}
            confirmLabel={t('settings.changeServer')}
            onConfirm={() => void run(session.forgetServer)}
            onCancel={() => setConfirming(null)}
            busy={busy}
            testID="confirm-change-server"
          />
        ) : null}
      </Section>
    </>
  );
}

export function PreferenceSections() {
  const { t } = useI18n();
  const router = useRouter();
  const { settings, update } = useSettings();
  const environment = useCurrentEnvironment();
  const environments = useFeature('environments');
  return (
    <>
      <Section title={t('settings.notifications')}>
        <Card padded={false}>
          <Row
            title={t('notifications.title')}
            subtitle={settings.notifications.enabled ? t('settings.notificationsOn') : t('settings.notificationsOff')}
            icon="notifications-outline"
            onPress={() => router.push('/settings/notifications')}
            testID="settings-notifications"
          />
        </Card>
      </Section>

      <Section title={t('settings.appearance')}>
        <Card padded={false} style={{ paddingVertical: spacing.sm, gap: spacing.sm }}>
          <Text variant="small" weight="600" tone="muted" style={{ paddingHorizontal: spacing.lg }}>
            {t('settings.theme')}
          </Text>
          <ChipGroup<ThemeMode>
            accessibilityLabel={t('settings.theme')}
            value={settings.themeMode}
            onChange={(themeMode) => update({ themeMode })}
            options={[
              { value: 'system', label: t('settings.theme.system'), icon: 'phone-portrait-outline' },
              { value: 'light', label: t('settings.theme.light'), icon: 'sunny-outline' },
              { value: 'dark', label: t('settings.theme.dark'), icon: 'moon-outline' },
            ]}
          />
          <Text variant="small" weight="600" tone="muted" style={{ paddingHorizontal: spacing.lg }}>
            {t('settings.language')}
          </Text>
          <ChipGroup<LocalePreference>
            accessibilityLabel={t('settings.language')}
            value={settings.locale}
            onChange={(locale) => update({ locale })}
            options={[
              { value: 'system', label: t('settings.language.system') },
              { value: 'en', label: t('settings.language.en') },
              { value: 'fr', label: t('settings.language.fr') },
            ]}
          />
        </Card>
      </Section>

      <Section title={t('settings.environment')}>
        <Card padded={false}>
          <Row
            title={environment?.name ?? t('settings.environmentDefault')}
            subtitle={environments ? t('settings.environmentHint') : t('settings.environmentSingle')}
            left={environment ? <EnvironmentBadge environment={environment} /> : undefined}
            icon="layers-outline"
            onPress={() => router.push('/settings/environment')}
            testID="settings-environment"
          />
          <Divider />
          <Row title={t('settings.favorites')} icon="star-outline" onPress={() => router.push('/settings/favorites')} testID="settings-favorites" />
        </Card>
      </Section>
    </>
  );
}

export function SecuritySection() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { settings, update } = useSettings();
  const [cleared, setCleared] = useState(false);
  const clearCache = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await AsyncStorage.removeItem(PREF_KEYS.queryCache);
    setCleared(true);
  };
  return (
    <Section title={t('settings.security')}>
      <Card padded={false}>
        <SwitchRow
          label={t('settings.privacyCover')}
          hint={t('settings.privacyCoverHint')}
          value={settings.privacyCover}
          onChange={(privacyCover) => update({ privacyCover })}
          testID="settings-privacy-cover"
        />
      </Card>
      <View style={{ alignSelf: 'flex-start' }}>
        <Button label={t('settings.clearCache')} icon="trash-outline" variant="secondary" onPress={() => void clearCache()} testID="settings-clear-cache" />
      </View>
      {cleared ? (
        <Note tone="healthy" testID="settings-cache-cleared">
          {t('settings.cacheCleared')}
        </Note>
      ) : null}
      <Note>{t('settings.credentialsNote')}</Note>
    </Section>
  );
}

export function AboutSection() {
  const { t } = useI18n();
  const config = Constants.expoConfig;
  const build = buildNumberOf(config, Platform.OS);
  const openSource = async () => {
    try {
      await WebBrowser.openBrowserAsync(SOURCE_CODE_URL);
    } catch {
      await Linking.openURL(SOURCE_CODE_URL);
    }
  };
  return (
    <Section title={t('settings.about')}>
      <Card>
        <KeyValue label={t('settings.appVersion')} value={config?.version ?? t('state.noData')} />
        {build ? <KeyValue label={t('settings.build')} value={build} /> : null}
        <KeyValue label={t('settings.apiVersion')} value={`v${API_VERSION}`} />
        <Text variant="small" tone="muted">
          {t('settings.license')}
        </Text>
      </Card>
      <Card padded={false}>
        <Row title={t('settings.sourceCode')} subtitle={displayServer(SOURCE_CODE_URL)} icon="logo-github" onPress={() => void openSource()} testID="settings-source" />
      </Card>
      <Card>
        <Text variant="small" weight="700" accessibilityRole="header">
          {t('settings.privacy')}
        </Text>
        <Text variant="small" tone="muted">
          {t('settings.privacyBody')}
        </Text>
      </Card>
    </Section>
  );
}
