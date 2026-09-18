import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { findCachedLogEntry } from '@/features/logs/helpers';
import { LogEntryDetail, LogNotFound } from '@/features/logs/detail';
import { useI18n } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';
import { ScrollScreen } from '@/ui/screen';
import { FeatureGate } from '@/ui/states';

/**
 * The API has no single-entry endpoint: the entry is taken from the log searches cached in memory (never persisted).
 * After a restart or when opened by link, there is nothing to show and the screen says so.
 */
export default function LogEntryScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const entry = isSafeId(id) ? findCachedLogEntry(queryClient.getQueriesData({ queryKey: ['logs'] }), id) : undefined;
  return (
    <FeatureGate feature="logs" label={t('nav.logs')}>
      <ScrollScreen testID="log-entry-screen">{entry ? <LogEntryDetail entry={entry} /> : <LogNotFound />}</ScrollScreen>
    </FeatureGate>
  );
}
