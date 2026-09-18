/**
 * Settings building blocks: a labelled switch row and an inline confirmation card (used instead of blocking system
 * dialogs, so it behaves the same on iOS, Android and web).
 */
import { StyleSheet, Switch, View } from 'react-native';
import { useI18n } from '@/i18n';
import { Button } from '@/ui/controls';
import { Card } from '@/ui/layout';
import { Text } from '@/ui/text';
import { spacing, TOUCH_TARGET } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';

export function SwitchRow({ label, hint, value, onChange, disabled, testID }: { label: string; hint?: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text weight="600">{label}</Text>
        {hint ? (
          <Text variant="small" tone="muted">
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityHint={hint}
        trackColor={{ true: colors.primary, false: colors.border }}
        testID={testID}
      />
    </View>
  );
}

export function ConfirmCard({ message, confirmLabel, onConfirm, onCancel, busy, testID }: { message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; busy?: boolean; testID?: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <Card accent={colors.critical}>
      <View style={{ gap: spacing.md }} accessibilityLiveRegion="polite" testID={testID}>
        <Text>{message}</Text>
        <View style={styles.buttons}>
          <Button label={t('action.cancel')} variant="secondary" onPress={onCancel} compact testID={testID ? `${testID}-cancel` : undefined} />
          <Button label={confirmLabel} variant="danger" onPress={onConfirm} loading={busy} compact testID={testID ? `${testID}-confirm` : undefined} />
        </View>
      </View>
    </Card>
  );
}

/** A small informative line with an icon-free, muted style. */
export function Note({ children, tone = 'muted', testID }: { children: string; tone?: 'muted' | 'warning' | 'critical' | 'healthy'; testID?: string }) {
  return (
    <Text variant="small" tone={tone} testID={testID} style={styles.note}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH_TARGET + 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  text: { flex: 1, gap: 2 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, flexWrap: 'wrap' },
  note: { paddingHorizontal: spacing.xs },
});
