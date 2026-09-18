import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import type { Severity } from '@/api/contract';
import { flattenPages, useProblems } from '@/api/queries';
import { ProblemFilterHeader, ProblemListRow } from '@/features/problems/components';
import { categoriesOf, DEFAULT_FILTERS, hasNarrowingFilters, sinceFor, toProblemFilters, type StatusFilter, type TimeRange } from '@/features/problems/helpers';
import { useI18n } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';
import { InfiniteListScreen } from '@/ui/list-screen';
import { FeatureGate } from '@/ui/states';

export default function ProblemsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{ service?: string }>();
  const service = isSafeId(params.service) ? params.service : null;

  const [status, setStatus] = useState<StatusFilter>(DEFAULT_FILTERS.status);
  const [severities, setSeverities] = useState<Severity[]>([]);
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

  const quiet = status === 'open' && !hasNarrowingFilters(state);

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
            : { title: t('problems.empty.filtered.title'), body: t('problems.empty.filtered.body'), icon: 'filter-outline' }
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
          />
        }
      />
    </FeatureGate>
  );
}
