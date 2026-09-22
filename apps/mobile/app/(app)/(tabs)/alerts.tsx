import { useState } from 'react';
import { useAlerts } from '@/api/queries';
import { AlertRow } from '@/features/alerts/components';
import { ALERT_TABS, emptyForTab, filtersForTab, type AlertTab } from '@/features/alerts/helpers';
import { useI18n } from '@/i18n';
import { ChipGroup } from '@/ui/controls';
import { InfiniteListScreen } from '@/ui/list-screen';
import { FeatureGate, useNow } from '@/ui/states';

export default function AlertsScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState<AlertTab>('active');
  const query = useAlerts(filtersForTab(tab));
  const now = useNow();
  const empty = emptyForTab(tab);
  return (
    <FeatureGate feature="alerts" label={t('tab.alerts')}>
      <InfiniteListScreen
        testID="alerts-screen"
        query={query}
        keyExtractor={(alert) => alert.id}
        renderItem={({ item }) => <AlertRow alert={item} now={now} />}
        header={
          <ChipGroup
            accessibilityLabel={t('alerts.filterLabel')}
            value={tab}
            onChange={setTab}
            options={ALERT_TABS.map((option) => ({ value: option.value, label: t(option.label) }))}
          />
        }
        empty={{ title: t(empty.title), body: t(empty.body), icon: 'notifications-off-outline' }}
      />
    </FeatureGate>
  );
}
