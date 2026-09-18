import { useState } from 'react';
import { View } from 'react-native';
import { useInfrastructure } from '@/api/queries';
import { CategoryChips, HealthSummary, InfraRow } from '@/features/infrastructure/components';
import { categoryFilters, type CategoryFilter } from '@/features/infrastructure/helpers';
import { useI18n } from '@/i18n';
import { ListScreen } from '@/ui/list-screen';
import { FeatureGate } from '@/ui/states';
import { spacing } from '@/ui/theme';

export default function InfrastructureScreen() {
  const { t } = useI18n();
  const [category, setCategory] = useState<CategoryFilter>('all');
  // The unfiltered list decides which category chips exist; the filtered one feeds the rows.
  const all = useInfrastructure();
  const resources = useInfrastructure(category === 'all' ? undefined : category);
  const categories = categoryFilters(all.data ?? []);

  return (
    <FeatureGate feature="infrastructure" label={t('nav.infrastructure')}>
      <ListScreen
        query={resources}
        testID="infrastructure-screen"
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <InfraRow resource={item} />}
        header={
          <View style={{ gap: spacing.sm }}>
            {categories.length > 1 ? <CategoryChips categories={categories} value={category} onChange={setCategory} /> : null}
            <HealthSummary resources={resources.data ?? []} />
          </View>
        }
        empty={{ title: t('infrastructure.empty'), icon: 'server-outline' }}
      />
    </FeatureGate>
  );
}
