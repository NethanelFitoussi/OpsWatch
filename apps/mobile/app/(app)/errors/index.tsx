import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { ErrorSummary } from '@/api/contract';
import { useErrors } from '@/api/queries';
import { ErrorRow } from '@/features/errors/components';
import { ERROR_STATUS_FILTERS, errorFilterLabelKey, errorFiltersFor, type ErrorStatusFilter } from '@/features/errors/helpers';
import { sinceFor, TIME_RANGES, type TimeRange } from '@/features/problems/helpers';
import { useI18n } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';
import { Chip, ChipGroup } from '@/ui/controls';
import { InfiniteListScreen } from '@/ui/list-screen';
import { FeatureGate } from '@/ui/states';
import { spacing } from '@/ui/theme';

export default function ErrorsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{ service?: string }>();
  const service = isSafeId(params.service) ? params.service : null;
  const [status, setStatus] = useState<ErrorStatusFilter>('all');
  // Epoch ms is computed once when the range is chosen, so the query key does not change on every render.
  const [range, setRange] = useState<TimeRange>('any');
  const [since, setSince] = useState<number | null>(null);
  const query = useErrors(errorFiltersFor(status, service, since));
  const serviceLabel = query.data?.pages[0]?.items[0]?.service?.label ?? service;

  return (
    <FeatureGate feature="errors" label={t('nav.errors')}>
      <InfiniteListScreen<ErrorSummary>
        query={query}
        testID="errors-screen"
        keyExtractor={(error) => error.id}
        renderItem={({ item }) => <ErrorRow error={item} />}
        header={
          <>
            <ChipGroup
              options={ERROR_STATUS_FILTERS.map((value) => ({ value, label: t(errorFilterLabelKey(value)) }))}
              value={status}
              onChange={setStatus}
              accessibilityLabel={t('filter.status')}
            />
            <ChipGroup
              options={TIME_RANGES.map((value) => ({ value, label: t(`time.range.${value}`), icon: value === 'any' ? undefined : ('time-outline' as const) }))}
              value={range}
              onChange={(value) => {
                setRange(value);
                setSince(sinceFor(value, Date.now()));
              }}
              accessibilityLabel={t('filter.time')}
            />
            {service ? (
              <View style={{ paddingHorizontal: spacing.lg, flexDirection: 'row' }}>
                {/* The label stays a plain sentence: a "✕" in it is read out as "multiplication sign" by a screen
                    reader, so the hint carries what tapping does instead. */}
                <Chip
                  label={t('errors.serviceFilter', { service: serviceLabel ?? service })}
                  selected
                  accessibilityHint={t('errors.serviceFilterHint')}
                  onPress={() => router.setParams({ service: undefined })}
                  testID="errors-service-filter"
                />
              </View>
            ) : null}
          </>
        }
        empty={{ title: status === 'all' && !service && since === null ? t('errors.emptyTitle') : t('errors.emptyFilteredTitle'), body: t('errors.emptyBody'), icon: 'bug-outline' }}
      />
    </FeatureGate>
  );
}
