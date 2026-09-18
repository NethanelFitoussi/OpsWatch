import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { forwardRef, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useI18n } from '@/i18n';
import type { IconName } from './layout';
import { Text } from './text';
import { radius, spacing, TOUCH_TARGET } from './theme';
import { useTheme } from './theme-provider';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
  compact?: boolean;
};

export function Button({ label, onPress, variant = 'primary', icon, loading, disabled, accessibilityHint, testID, compact }: ButtonProps) {
  const { colors } = useTheme();
  const inactive = disabled || loading;
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.criticalBg : variant === 'secondary' ? colors.surfaceAlt : 'transparent';
  const fg = variant === 'primary' ? colors.onPrimary : variant === 'danger' ? colors.critical : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        { backgroundColor: bg, opacity: inactive ? 0.55 : pressed ? 0.8 : 1 },
        variant === 'secondary' && { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} importantForAccessibility="no" /> : null}
      <Text variant="body" weight="700" style={{ color: fg }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, icon, count, testID }: { label: string; selected: boolean; onPress: () => void; icon?: IconName; count?: number; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
      testID={testID}
      hitSlop={{ top: 6, bottom: 6 }}
      style={[
        styles.chip,
        { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : colors.surface },
      ]}
    >
      {selected ? <Ionicons name="checkmark" size={14} color={colors.onPrimary} importantForAccessibility="no" /> : icon ? <Ionicons name={icon} size={14} color={colors.textMuted} importantForAccessibility="no" /> : null}
      <Text variant="small" weight="600" style={{ color: selected ? colors.onPrimary : colors.text }} numberOfLines={1}>
        {count === undefined ? label : `${label} · ${count}`}
      </Text>
    </Pressable>
  );
}

export type ChipOption<T extends string> = { value: T; label: string; icon?: IconName };

/** A horizontally scrolling single-choice chip row, used for filters. */
export function ChipGroup<T extends string>({ options, value, onChange, accessibilityLabel }: { options: ChipOption<T>[]; value: T; onChange: (value: T) => void; accessibilityLabel: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel={accessibilityLabel} accessibilityRole="radiogroup">
      {options.map((option) => (
        <Chip key={option.value} label={option.label} icon={option.icon} selected={option.value === value} onPress={() => onChange(option.value)} testID={`chip-${option.value}`} />
      ))}
    </ScrollView>
  );
}

/** Multi-choice variant: an empty selection means "all". */
export function MultiChipGroup<T extends string>({ options, values, onChange, accessibilityLabel }: { options: ChipOption<T>[]; values: T[]; onChange: (values: T[]) => void; accessibilityLabel: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const selected = values.includes(option.value);
        return (
          <Chip
            key={option.value}
            label={option.label}
            icon={option.icon}
            selected={selected}
            testID={`chip-${option.value}`}
            onPress={() => onChange(selected ? values.filter((v) => v !== option.value) : [...values, option.value])}
          />
        );
      })}
    </ScrollView>
  );
}

export const TextField = forwardRef<TextInput, TextInputProps & { label: string; error?: string | null; icon?: IconName }>(function TextField({ label, error, icon, style, ...rest }, ref) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text variant="small" weight="600" tone="muted" nativeID={`${rest.testID ?? label}-label`}>
        {label}
      </Text>
      <View style={[styles.inputWrap, { borderColor: error ? colors.critical : colors.border, backgroundColor: colors.surface }]}>
        {icon ? <Ionicons name={icon} size={18} color={colors.textFaint} importantForAccessibility="no" /> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textFaint}
          accessibilityLabel={label}
          accessibilityLabelledBy={`${rest.testID ?? label}-label`}
          style={[styles.input, { color: colors.text }, style]}
          maxFontSizeMultiplier={1.6}
          {...rest}
        />
      </View>
      {error ? (
        <View style={styles.fieldError} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle" size={14} color={colors.critical} importantForAccessibility="no" />
          <Text variant="small" tone="critical" style={{ flex: 1 }}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

/** Copies on explicit user action only; the "Copied" confirmation is announced to screen readers. */
export function CopyButton({ text, label, testID }: { text: string; label?: string; testID?: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <Pressable
      onPress={async () => {
        await Clipboard.setStringAsync(text);
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1800);
      }}
      accessibilityRole="button"
      accessibilityLabel={copied ? t('action.copied') : (label ?? t('action.copy'))}
      hitSlop={8}
      testID={testID}
      style={styles.copy}
    >
      <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={copied ? colors.healthy : colors.primary} importantForAccessibility="no" />
      <Text variant="small" weight="600" style={{ color: copied ? colors.healthy : colors.primary }} accessibilityLiveRegion="polite">
        {copied ? t('action.copied') : (label ?? t('action.copy'))}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: TOUCH_TARGET, borderRadius: radius.md, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  compact: { minHeight: 40, paddingHorizontal: spacing.md },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  field: { gap: 6 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: TOUCH_TARGET },
  input: { flex: 1, fontSize: 16, paddingVertical: spacing.sm },
  fieldError: { flexDirection: 'row', gap: 4, alignItems: 'flex-start' },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, paddingHorizontal: 4 },
});
