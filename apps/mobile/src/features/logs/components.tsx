/**
 * Log search building blocks: level badge, compact result row, search form, statistics and the first-run examples.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { LogEntry, LogLevel, LogSearch } from '@/api/contract';
import { useI18n } from '@/i18n';
import { logPreview } from '@/lib/format';
import { Badge } from '@/ui/badges';
import { Button, Chip, ChipGroup, MultiChipGroup, TextField } from '@/ui/controls';
import { EmptyState } from '@/ui/states';
import { Text } from '@/ui/text';
import { monoFont, spacing, TOUCH_TARGET } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';
import { MAX_CONTENT_WIDTH } from '@/ui/screen';
import { EXAMPLE_SEARCHES, formatLogTime, LEVEL_FILTERS, levelIcon, levelLabelKey, levelTone, LOG_RANGES, rangeLabelKey, type LevelFilter, type LogRange } from './helpers';

export function LevelBadge({ level }: { level: LogLevel }) {
  const { t } = useI18n();
  return <Badge tone={levelTone(level)} icon={levelIcon(level)} label={t(levelLabelKey(level))} testID={`log-level-${level}`} />;
}

export function logHref(id: string): Href {
  return `/logs/${encodeURIComponent(id)}` as Href;
}

export const LogRow = memo(function LogRow({ entry }: { entry: LogEntry }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const time = formatLogTime(entry.timestamp);
  const preview = logPreview(entry.message);
  return (
    <Pressable
      onPress={() => router.push(logHref(entry.id))}
      accessibilityRole="button"
      accessibilityLabel={[time, t(levelLabelKey(entry.level)), entry.service, preview].filter(Boolean).join(', ')}
      testID={`logs-row-${entry.id}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
    >
      <View style={styles.rowHead}>
        <Text variant="caption" tone="muted" style={styles.time}>
          {time}
        </Text>
        <LevelBadge level={entry.level} />
        {entry.service ? (
          <Text variant="caption" weight="600" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
            {entry.service}
          </Text>
        ) : null}
      </View>
      <Text variant="small" numberOfLines={1} style={{ fontFamily: monoFont }}>
        {preview}
      </Text>
    </Pressable>
  );
});

type SearchFormProps = {
  text: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  range: LogRange;
  onRange: (range: LogRange) => void;
  levels: LevelFilter[];
  onLevels: (levels: LevelFilter[]) => void;
  service: string;
  services: string[];
  onService: (service: string) => void;
};

export const ALL_SERVICES = '__all__';

/** Search field and filters. Changing a filter re-runs the current search; typing only runs on submit. */
export function LogSearchForm(props: SearchFormProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View style={[styles.form, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <View style={styles.inset}>
        <TextField
          label={t('logs.searchLabel')}
          icon="search"
          value={props.text}
          onChangeText={props.onChangeText}
          onSubmitEditing={props.onSubmit}
          placeholder={t('logs.searchPlaceholder')}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          testID="logs-search-input"
        />
      </View>
      <ChipGroup
        options={LOG_RANGES.map((value) => ({ value, label: t(rangeLabelKey(value)) }))}
        value={props.range}
        onChange={props.onRange}
        accessibilityLabel={t('filter.time')}
      />
      <MultiChipGroup
        options={LEVEL_FILTERS.map((value) => ({ value, label: t(levelLabelKey(value)), icon: levelIcon(value) }))}
        values={props.levels}
        onChange={props.onLevels}
        accessibilityLabel={t('logs.levels')}
      />
      {props.services.length ? (
        <ChipGroup
          options={[{ value: ALL_SERVICES, label: t('logs.allServices') }, ...props.services.map((name) => ({ value: name, label: name }))]}
          value={props.service}
          onChange={props.onService}
          accessibilityLabel={t('filter.service')}
        />
      ) : null}
      <View style={styles.inset}>
        <Button label={t('logs.search')} icon="search" onPress={props.onSubmit} compact testID="logs-search-submit" />
      </View>
    </View>
  );
}

/** "1,204 records matched of 51,300 scanned", plus a note when the search is partial or still running. */
export function LogSearchSummary({ statistics, status }: { statistics?: LogSearch['statistics']; status?: LogSearch['status'] }) {
  const { t, locale } = useI18n();
  const note = status === 'partial' ? t('logs.partial') : status === 'running' ? t('logs.stillRunning') : status === 'failed' ? t('logs.failed') : null;
  if (!statistics && !note) return null;
  return (
    <View style={[styles.inset, { gap: 2 }]} testID="logs-statistics">
      {statistics ? (
        <Text variant="small" tone="muted">
          {t('logs.statistics', { matched: statistics.recordsMatched.toLocaleString(locale), scanned: statistics.recordsScanned.toLocaleString(locale) })}
        </Text>
      ) : null}
      {note ? (
        <Text variant="small" tone={status === 'failed' ? 'critical' : 'warning'}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** Shown before the first search: what the screen does and a few one-tap examples. */
export function LogExamples({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <ScrollView contentContainerStyle={styles.examplesWrap} keyboardShouldPersistTaps="handled" testID="logs-examples">
      <EmptyState
        icon="document-text-outline"
        title={t('logs.introTitle')}
        body={t('logs.introBody')}
        action={
          <View style={{ gap: spacing.sm, alignItems: 'center' }}>
            <View style={styles.examplesTitle}>
              <Ionicons name="bulb-outline" size={14} color={colors.textMuted} importantForAccessibility="no" />
              <Text variant="label" tone="muted">
                {t('logs.examples').toUpperCase()}
              </Text>
            </View>
            <View style={styles.examples}>
              {EXAMPLE_SEARCHES.map((example) => (
                <Chip key={example} label={example} selected={false} icon="search" onPress={() => onPick(example)} testID={`logs-example-${example}`} />
              ))}
            </View>
          </View>
        }
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: 4, minHeight: TOUCH_TARGET + 8, justifyContent: 'center' },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  time: { fontFamily: monoFont, fontVariant: ['tabular-nums'] },
  form: { gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
  inset: { paddingHorizontal: spacing.lg },
  examplesWrap: { flexGrow: 1 },
  examplesTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  examples: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
});
