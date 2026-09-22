/**
 * Layout primitives: cards, sections, rows, key/value lines. Rows are at least TOUCH_TARGET tall and expose their
 * role and label to screen readers.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './text';
import { radius, spacing, TOUCH_TARGET } from './theme';
import { useTheme } from './theme-provider';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Card({ children, style, padded = true, accent, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean; accent?: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        padded && { padding: spacing.lg },
        accent && { borderLeftWidth: 4, borderLeftColor: accent },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Section({ title, action, children, style }: { title?: string; action?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.section, style]}>
      {(title || action) && (
        <View style={styles.sectionHeader}>
          {title ? (
            <Text variant="label" tone="muted" accessibilityRole="header">
              {title.toUpperCase()}
            </Text>
          ) : (
            <View />
          )}
          {action}
        </View>
      )}
      {children}
    </View>
  );
}

export type RowProps = {
  title: string;
  subtitle?: string;
  icon?: IconName;
  iconColor?: string;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  chevron?: boolean;
  numberOfLines?: number;
  testID?: string;
};

export function Row({ title, subtitle, icon, iconColor, left, right, onPress, accessibilityLabel, accessibilityHint, chevron, numberOfLines = 2, testID }: RowProps) {
  const { colors } = useTheme();
  const content = (
    <>
      {left ?? (icon ? <Ionicons name={icon} size={22} color={iconColor ?? colors.textMuted} style={styles.rowIcon} /> : null)}
      <View style={styles.rowText}>
        <Text variant="body" weight="600" numberOfLines={numberOfLines}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" tone="muted" numberOfLines={numberOfLines}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {(chevron ?? !!onPress) && <Ionicons name="chevron-forward" size={18} color={colors.textFaint} importantForAccessibility="no" />}
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.row} accessible accessibilityLabel={accessibilityLabel} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
    >
      {content}
    </Pressable>
  );
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

export function KeyValue({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <View style={styles.kv} accessible accessibilityLabel={typeof value === 'string' ? `${label}: ${value}` : undefined}>
      <Text variant="small" tone="muted" style={styles.kvLabel}>
        {label}
      </Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text variant={mono ? 'mono' : 'small'} weight={mono ? undefined : '600'} style={styles.kvValue} selectable>
          {value}
        </Text>
      ) : (
        <View style={styles.kvValue}>{value}</View>
      )}
    </View>
  );
}

export function Gap({ size = 'md' }: { size?: keyof typeof spacing }) {
  return <View style={{ height: spacing[size] }} />;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 24, paddingHorizontal: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: TOUCH_TARGET + 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.md },
  rowIcon: { width: 24, textAlign: 'center' },
  rowText: { flex: 1, gap: 2 },
  kv: { flexDirection: 'row', paddingVertical: spacing.xs, gap: spacing.md },
  kvLabel: { width: '38%' },
  kvValue: { flex: 1 },
});
