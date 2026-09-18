import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import type { LogQuery } from '@/api/client';
import type { LogEntry } from '@/api/contract';
import { useLogs, useServices } from '@/api/queries';
import { ALL_SERVICES, LogExamples, LogRow, LogSearchForm, LogSearchSummary } from '@/features/logs/components';
import { buildLogQuery, DEFAULT_LOG_RANGE, searchStatistics, searchStatus, type LevelFilter, type LogRange } from '@/features/logs/helpers';
import { useI18n } from '@/i18n';
import { InfiniteListScreen } from '@/ui/list-screen';
import { FeatureGate } from '@/ui/states';
import { useTheme } from '@/ui/theme-provider';

type Form = { text: string; range: LogRange; levels: LevelFilter[]; service: string };

export default function LogsScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [form, setForm] = useState<Form>({ text: '', range: DEFAULT_LOG_RANGE, levels: [], service: ALL_SERVICES });
  // `null` until the first search: nothing is requested before the user asks. Logs are never persisted (see useLogs).
  const [query, setQuery] = useState<LogQuery | null>(null);
  const logs = useLogs(query);
  const services = useServices();
  const serviceNames = (services.data ?? []).map((s) => s.name).sort((a, b) => a.localeCompare(b));

  // The time window is computed at submit time, so "last hour" is the hour before the tap.
  const run = (next: Form) => setQuery(buildLogQuery({ ...next, service: next.service === ALL_SERVICES ? null : next.service }, Date.now()));
  // Filters re-run the current search right away; before the first search they only change the form.
  const change = (patch: Partial<Form>) => {
    const next = { ...form, ...patch };
    setForm(next);
    if (query) run(next);
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
        />
        <View style={{ flex: 1 }}>
          {query === null ? (
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
              header={<LogSearchSummary statistics={searchStatistics(logs.data?.pages)} status={searchStatus(logs.data?.pages)} />}
              empty={{ title: t('logs.emptyTitle'), body: t('logs.emptyBody'), icon: 'search-outline' }}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </FeatureGate>
  );
}
