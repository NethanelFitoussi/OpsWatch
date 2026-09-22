import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Platform, View } from 'react-native';
import type { LogQuery } from '@/api/client';
import type { LogEntry } from '@/api/contract';
import { useLogs, useServices } from '@/api/queries';
import { ALL_SERVICES, LogExamples, LogRow, LogSearchForm, LogSearchSummary } from '@/features/logs/components';
import { buildLogQuery, DEFAULT_LOG_RANGE, formatLogWindow, searchStatistics, searchStatus, type LevelFilter, type LogRange } from '@/features/logs/helpers';
import { useI18n } from '@/i18n';
import { InfiniteListScreen } from '@/ui/list-screen';
import { FeatureGate } from '@/ui/states';
import { useTheme } from '@/ui/theme-provider';

type Form = { text: string; range: LogRange; levels: LevelFilter[]; service: string };
/** The search being shown, with the range it was submitted with, so the window on screen always matches the results. */
type Submitted = { query: LogQuery; range: LogRange };

export default function LogsScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>({ text: '', range: DEFAULT_LOG_RANGE, levels: [], service: ALL_SERVICES });
  // `null` until the first search: nothing is requested before the user asks. Logs are never persisted (see useLogs).
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const logs = useLogs(submitted?.query ?? null);
  const services = useServices();
  const serviceNames = (services.data ?? []).map((s) => s.name).sort((a, b) => a.localeCompare(b));
  // A first search or a refresh is on its way; loading another page is not, and must not offer to stop the search.
  const busy = submitted !== null && logs.isFetching && !logs.isFetchingNextPage;
  const hasResults = (logs.data?.pages.length ?? 0) > 0;

  // The time window is computed at submit time, so "last hour" is the hour before the tap.
  const run = (next: Form) =>
    setSubmitted({
      query: buildLogQuery({ ...next, service: next.service === ALL_SERVICES ? null : next.service }, Date.now()),
      range: next.range,
    });
  // Filters re-run the current search right away; before the first search they only change the form.
  const change = (patch: Partial<Form>) => {
    const next = { ...form, ...patch };
    setForm(next);
    if (submitted) run(next);
  };
  /**
   * Stopping cancels the request, and that is what releases the server-side query: `useLogs` sees the aborted signal
   * and sends the DELETE. Leaving the screen does the same, because the query loses its last observer.
   * Results already on screen are kept — cancelling a refresh must not throw away what was found.
   */
  const stop = () => {
    void queryClient.cancelQueries({ queryKey: ['logs'] });
    if (!hasResults) setSubmitted(null);
    AccessibilityInfo.announceForAccessibility(t('logs.stopped'));
  };

  return (
    <FeatureGate feature="logs" label={t('nav.logs')}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} testID="logs-screen">
        <LogSearchForm
          text={form.text}
          onChangeText={(text) => setForm({ ...form, text })}
          onSubmit={() => run(form)}
          range={form.range}
          onRange={(range) => change({ range })}
          levels={form.levels}
          onLevels={(levels) => change({ levels })}
          service={form.service}
          services={serviceNames}
          onService={(service) => change({ service })}
          busy={busy}
          onStop={stop}
          searched={submitted ? { range: submitted.range, label: formatLogWindow(submitted.query.from, submitted.query.to) } : null}
        />
        <View style={{ flex: 1 }}>
          {submitted === null ? (
            <LogExamples
              onPick={(text) => {
                const next = { ...form, text };
                setForm(next);
                run(next);
              }}
            />
          ) : (
            <InfiniteListScreen<LogEntry>
              query={logs}
              testID="logs-results"
              keyExtractor={(entry) => entry.id}
              renderItem={({ item }) => <LogRow entry={item} />}
              header={<LogSearchSummary statistics={searchStatistics(logs.data?.pages)} status={searchStatus(logs.data?.pages)} onRetry={() => void logs.refetch()} />}
              empty={{ title: t('logs.emptyTitle'), body: t('logs.emptyBody'), icon: 'search-outline' }}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </FeatureGate>
  );
}
