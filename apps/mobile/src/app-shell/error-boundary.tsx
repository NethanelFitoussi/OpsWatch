/**
 * The last line of defence. Everything on screen is built from data a server sends, and a render-time throw would
 * otherwise unmount the whole tree and leave a blank app with no way back — during an incident, which is exactly
 * when the app is being used.
 *
 * It catches the throw, shows what happened in the app's own words, and offers to try again (which re-renders the
 * subtree) or to go back to Home. The error is logged through the redacting logger and never shown raw: it can
 * contain fragments of server data.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useI18n } from '@/i18n';
import { log } from '@/lib/log';
import { Button } from '@/ui/controls';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';

function Fallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="app-error-boundary">
      <Text variant="title" accessibilityRole="header" style={styles.centered}>
        {t('error.crashTitle')}
      </Text>
      <Text tone="muted" style={styles.centered}>
        {t('error.crashBody')}
      </Text>
      <View style={styles.actions}>
        <Button label={t('action.retry')} icon="refresh" onPress={onRetry} testID="app-error-retry" />
        <Button
          label={t('tab.home')}
          variant="secondary"
          onPress={() => {
            onRetry();
            router.replace('/');
          }}
          testID="app-error-home"
        />
      </View>
    </View>
  );
}

type Props = { children: ReactNode };
type State = { failed: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Redacted, and without the component stack's props: both can carry server data.
    log.error('A screen failed to render', `${error.name}: ${error.message}`);
    void info;
  }

  override render(): ReactNode {
    if (this.state.failed) return <Fallback onRetry={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  centered: { textAlign: 'center', maxWidth: 420 },
  actions: { gap: spacing.sm, alignSelf: 'stretch', maxWidth: 420, marginTop: spacing.md },
});
