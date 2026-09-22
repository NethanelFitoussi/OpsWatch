import { useState } from 'react';
import { useServices } from '@/api/queries';
import { ServiceFilters, ServiceRow } from '@/features/services/components';
import { favoritesFirst, filterServices, type HealthFilter } from '@/features/services/helpers';
import { useFavorites } from '@/features/shared/components';
import { useI18n } from '@/i18n';
import { ListScreen } from '@/ui/list-screen';
import { FeatureGate } from '@/ui/states';

export default function ServicesScreen() {
  const { t } = useI18n();
  const services = useServices();
  const { isFavorite } = useFavorites();
  const [text, setText] = useState('');
  const [health, setHealth] = useState<HealthFilter>('all');

  const favorite = (id: string) => isFavorite('service', id);
  // The server sorts unhealthy services first; favorites are pinned on top without changing that order.
  const visible = services.data ? favoritesFirst(filterServices(services.data, text, health), favorite) : undefined;
  const filtered = text.trim() !== '' || health !== 'all';

  return (
    <FeatureGate feature="services" label={t('tab.services')}>
      <ListScreen
        query={{ ...services, data: visible } as typeof services}
        testID="services-screen"
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <ServiceRow service={item} favorite={favorite(item.id)} />}
        header={<ServiceFilters text={text} onText={setText} health={health} onHealth={setHealth} />}
        empty={filtered ? { title: t('services.emptyFiltered'), icon: 'search-outline' } : { title: t('services.empty'), icon: 'apps-outline' }}
      />
    </FeatureGate>
  );
}
