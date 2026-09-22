import { SearchScreen } from '@/features/search/search-screen';
import { useI18n } from '@/i18n';
import { FeatureGate } from '@/ui/states';

export default function SearchRoute() {
  const { t } = useI18n();
  return (
    <FeatureGate feature="search" label={t('nav.search')}>
      <SearchScreen />
    </FeatureGate>
  );
}
