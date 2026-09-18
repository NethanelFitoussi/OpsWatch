import { useMemo } from 'react';
import { useSynthetics } from '@/api/queries';
import { SyntheticRow, SyntheticsSummary } from '@/features/synthetics/components';
import { sortFailuresFirst } from '@/features/synthetics/helpers';
import { useI18n } from '@/i18n';
import { ListScreen } from '@/ui/list-screen';
import { FeatureGate, useNow } from '@/ui/states';

export default function SyntheticsScreen() {
  const { t } = useI18n();
  const query = useSynthetics();
  const now = useNow();
  const sorted = useMemo(() => (query.data ? sortFailuresFirst(query.data) : undefined), [query.data]);
  return (
    <FeatureGate feature="synthetics" label={t('nav.synthetics')}>
      <ListScreen
        testID="synthetics-screen"
        query={{ ...query, data: sorted } as typeof query}
        keyExtractor={(synthetic) => synthetic.id}
        renderItem={({ item }) => <SyntheticRow synthetic={item} now={now} />}
        header={sorted?.length ? <SyntheticsSummary items={sorted} /> : undefined}
        empty={{ title: t('synthetics.empty'), body: t('synthetics.emptyBody'), icon: 'pulse-outline' }}
      />
    </FeatureGate>
  );
}
