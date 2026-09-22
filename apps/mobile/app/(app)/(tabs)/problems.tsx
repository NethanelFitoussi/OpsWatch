import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import type { Severity } from '@/api/contract';
import { flattenPages, useProblems } from '@/api/queries';
import { ProblemFilterHeader, ProblemListRow } from '@/features/problems/components';
import {
  activeFilterLabels,
  categoriesOf,
  DEFAULT_FILTERS,
  hasNarrowingFilters,
  parseSeverities,
  sinceFor,
  toProblemFilters,
  type StatusFilter,
  type TimeRange,
} from '@/features/problems/helpers';
import { useI18n } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';
import { InfiniteListScreen } from '@/ui/list-screen';
import { FeatureGate } from '@/ui/states';

export default function ProblemsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{ service?: string; severity?: string }>();
  const service = isSafeId(params.service) ? params.service : null;
  // Severity lives in the route so Home can open this list already narrowed ("2 critical" → the two problems).
  const severities = parseSeverities(params.severity);
  const setSeverities = useCallback((next: Severity[]) => router.setParams({ severity: next.length ? next.join(',') : undefined }), [router]);

  const [status, setStatus] = useState<StatusFilter>(DEFAULT_FILTERS.status);
  const [category, setCategory] = useState<string | null>(null);
  const [range, setRange] = useState<TimeRange>('any');
  const [since, setSince] = useState<number | null>(null);

  const state = { status, severities, category, since, service };
  const query = useProblems(toProblemFilters(state));
  // Same query without the category, so the category chips do not disappear once one is chosen. When no category is
  // selected both keys are identical and React Query fetches once.
  const unfiltered = useProblems(toProblemFilters(state, { withCategory: false }));
  const loaded = flattenPages(unfiltered.data);
  const categories = categoriesOf(loaded, category);
  const serviceLabel = service ? (loaded.find((p) => p.service?.id === service)?.service?.label ?? service) : null;

  const quiet = status === DEFAULT_FILTERS.status && !hasNarrowingFilters(state);

  return (
    <FeatureGate feature="problems" label={t('tab.problems')}>
      <InfiniteListScreen
        testID="problems-screen"
        query={query}
        keyExtractor={(problem) => problem.id}
        renderItem={({ item }) => <ProblemListRow problem={item} />}
        empty={
          quiet
            ? { title: t('problems.empty.open.title'), body: t('problems.empty.open.body'), icon: 'checkmark-circle-outline' }
            : {
                title: t('problems.empty.filtered.title'),
                // An empty list always names the filters that emptied it; the header keeps a way to clear them.
                body: t('problems.empty.filtered.body', { filters: activeFilterLabels(t, state, range, serviceLabel).join(' · ') }),
                icon: 'filter-outline',
              }
        }
        header={
          <ProblemFilterHeader
            status={status}
            onStatus={setStatus}
            severities={severities}
            onSeverities={setSeverities}
            categories={categories}
            category={category}
            onCategory={setCategory}
            range={range}
            onRange={(next) => {
              setRange(next);
              setSince(sinceFor(next, Date.now()));
            }}
            service={service && serviceLabel ? { id: service, label: serviceLabel } : null}
            onClearService={() => router.setParams({ service: undefined })}
            filtered={!quiet}
            onClearAll={() => {
              setStatus(DEFAULT_FILTERS.status);
              setCategory(null);
              setRange('any');
              setSince(null);
              router.setParams({ service: undefined, severity: undefined });
            }}
          />
        }
      />
    </FeatureGate>
  );
}
