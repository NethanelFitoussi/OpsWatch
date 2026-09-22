import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View, type TextInput } from 'react-native';
import { isApiError } from '@/api/errors';
import { DEMO_CREDENTIALS } from '@/demo/fixtures';
import { useI18n, type MessageKey } from '@/i18n';
import { displayServer } from '@/lib/server-url';
import { useSession } from '@/state/session';
import { Button, TextField } from '@/ui/controls';
import { Card, Gap } from '@/ui/layout';
import { ScrollScreen } from '@/ui/screen';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';

export function loginErrorKey(error: unknown): MessageKey {
  if (!isApiError(error)) return 'error.network';
  if (error.kind === 'unauthorized' || error.code === 'invalid_credentials') return 'login.error.invalid';
  if (error.kind === 'rate_limited') return 'login.error.throttled';
  if (error.kind === 'cancelled') return 'login.error.googleCancelled';
  return `error.${error.kind}` as MessageKey;
}

export default function LoginScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { state, signIn, signInWithGoogle, forgetServer } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState<'password' | 'google' | null>(null);
  const passwordRef = useRef<TextInput>(null);

  if (state.status !== 'signed-out') return null;
  const { server } = state;
  const auth = server.info?.auth ?? { password: true, google: false };

  const submit = async () => {
    if (!email.trim() || !password) return;
    setBusy('password');
    setError(null);
    try {
      await signIn(email, password);
    } catch (e) {
      setError(loginErrorKey(e));
      setPassword('');
    } finally {
      setBusy(null);
    }
  };

  const google = async () => {
    setBusy('google');
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(isApiError(e) && e.kind === 'cancelled' ? 'login.error.googleCancelled' : 'login.error.googleFailed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollScreen testID="login-screen">
        <Gap size="xxl" />
        <View style={{ gap: spacing.xs }}>
          <Text variant="headline" accessibilityRole="header">
            {t('login.title')}
          </Text>
          <Text tone="muted">{t('login.subtitle', { server: server.info?.name ?? displayServer(server.url) })}</Text>
        </View>

        {state.reason === 'expired' ? (
          <Card accent={colors.warning}>
            <View style={styles.row} accessibilityLiveRegion="polite">
              <Ionicons name="time-outline" size={18} color={colors.warning} importantForAccessibility="no" />
              <Text style={{ flex: 1 }}>{t('login.sessionExpired')}</Text>
            </View>
          </Card>
        ) : null}

        {auth.password ? (
          <View style={{ gap: spacing.md }}>
            <TextField
              label={t('login.email')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              icon="mail-outline"
              testID="login-email"
            />
            <TextField
              ref={passwordRef}
              label={t('login.password')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              icon="lock-closed-outline"
              testID="login-password"
              error={error ? t(error) : null}
            />
            <Button label={busy === 'password' ? t('login.submitting') : t('login.submit')} onPress={() => void submit()} loading={busy === 'password'} disabled={!email.trim() || !password || busy !== null} testID="login-submit" />
          </View>
        ) : (
          <Text tone="muted">{t('login.error.passwordDisabled')}</Text>
        )}

        {auth.google ? <Button label={t('login.google')} variant="secondary" icon="logo-google" onPress={() => void google()} loading={busy === 'google'} disabled={busy !== null} testID="login-google" /> : null}
        {!auth.password && error ? (
          <Text tone="critical" accessibilityLiveRegion="polite">
            {t(error)}
          </Text>
        ) : null}

        {__DEV__ && server.url.includes('localhost:4010') ? (
          <Text variant="small" tone="faint">
            {t('login.demoHint', DEMO_CREDENTIALS)}
          </Text>
        ) : null}

        <Button label={t('login.changeServer')} variant="ghost" icon="swap-horizontal" onPress={() => void forgetServer()} disabled={busy !== null} testID="change-server" />
      </ScrollScreen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
