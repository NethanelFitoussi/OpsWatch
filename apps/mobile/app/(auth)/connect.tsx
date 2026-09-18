import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Switch, View } from 'react-native';
import { FEATURES } from '@/api/contract';
import { useServerCheck } from '@/features/auth/use-server-check';
import { useI18n } from '@/i18n';
import { log } from '@/lib/log';
import { displayServer } from '@/lib/server-url';
import { useSession } from '@/state/session';
import { Button, TextField } from '@/ui/controls';
import { Card, Gap, KeyValue } from '@/ui/layout';
import { ScrollScreen } from '@/ui/screen';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';

const defaultServerUrl = (Constants.expoConfig?.extra?.defaultServerUrl as string | undefined) ?? '';

export default function ConnectScreen() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const { connect, startDemo } = useSession();
  const [url, setUrl] = useState(defaultServerUrl);
  // Plain HTTP to a LAN/loopback host exists for contributors only; release builds never offer it.
  const [allowInsecure, setAllowInsecure] = useState(false);
  const { check, run, reset } = useServerCheck({ allowInsecureLocal: __DEV__ && allowInsecure, locale });
  const [busy, setBusy] = useState(false);

  const onContinue = async () => {
    const result = check.status === 'ok' ? check : await run(url);
    if (result.status !== 'ok') return;
    setBusy(true);
    try {
      await connect({ url: result.url, insecure: result.insecure, info: result.info });
    } finally {
      setBusy(false);
    }
  };

  const onDemo = async () => {
    setBusy(true);
    try {
      await startDemo();
    } catch (error) {
      log.warn('Demo start failed', error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollScreen testID="connect-screen">
        <Gap size="xxl" />
        <View style={styles.brand}>
          <Ionicons name="pulse" size={40} color={colors.primary} importantForAccessibility="no" />
          <Text variant="headline" accessibilityRole="header">
            {t('connect.title')}
          </Text>
          <Text tone="muted">{t('connect.subtitle')}</Text>
        </View>

        <TextField
          label={t('connect.urlLabel')}
          placeholder={t('connect.urlPlaceholder')}
          value={url}
          onChangeText={(text) => {
            setUrl(text);
            reset();
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
          returnKeyType="go"
          onSubmitEditing={() => void run(url)}
          icon="server-outline"
          testID="server-url"
          error={check.status === 'error' ? t(check.message, check.params) : null}
        />

        {__DEV__ ? (
          <View style={styles.switchRow}>
            <Text variant="small" tone="muted" style={{ flex: 1 }}>
              {t('connect.allowInsecure')}
            </Text>
            <Switch
              value={allowInsecure}
              onValueChange={(value) => {
                setAllowInsecure(value);
                reset();
              }}
              accessibilityLabel={t('connect.allowInsecure')}
              testID="allow-insecure"
            />
          </View>
        ) : null}

        {check.status === 'ok' ? (
          <Card accent={check.insecure ? colors.warning : colors.healthy}>
            <View style={styles.okTitle} accessibilityLiveRegion="polite">
              <Ionicons name="checkmark-circle" size={20} color={colors.healthy} importantForAccessibility="no" />
              <Text weight="700" style={{ flex: 1 }} testID="connect-success">
                {t('connect.success', { name: check.info.name ?? displayServer(check.url), version: check.info.version })}
              </Text>
            </View>
            {check.insecure ? (
              <Text variant="small" tone="warning" style={{ marginTop: spacing.sm }}>
                {t('connect.insecureWarning')}
              </Text>
            ) : null}
            <Gap size="sm" />
            <KeyValue label={t('connect.signInMethods')} value={[check.info.auth.password ? 'Email' : null, check.info.auth.google ? 'Google' : null].filter(Boolean).join(', ')} />
            <KeyValue label={t('connect.features')} value={String(FEATURES.filter((f) => check.info.features[f]).length) + ' / ' + FEATURES.length} />
          </Card>
        ) : null}

        <View style={styles.actions}>
          <Button label={check.status === 'checking' ? t('connect.testing') : t('connect.test')} variant="secondary" icon="pulse-outline" onPress={() => void run(url)} loading={check.status === 'checking'} testID="test-connection" />
          <Button label={t('connect.continue')} onPress={() => void onContinue()} loading={busy} disabled={check.status === 'checking'} testID="connect-continue" />
        </View>

        <Gap size="lg" />
        <Card>
          <Text weight="700">{t('connect.demo')}</Text>
          <Text variant="small" tone="muted" style={{ marginVertical: spacing.sm }}>
            {t('connect.demoHint')}
          </Text>
          <Button label={t('connect.demo')} variant="ghost" icon="flask-outline" onPress={() => void onDemo()} disabled={busy} testID="start-demo" />
        </Card>
      </ScrollScreen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  brand: { gap: spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  okTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { gap: spacing.sm },
});
