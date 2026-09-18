/**
 * Resource detail body: health, anomalies, key metrics, trends, properties, related objects and problems.
 */
import { Stack } from 'expo-router';
import type { InfraDetail } from '@/api/contract';
import { useInfrastructureResource } from '@/api/queries';
import { MetricTile, ProblemRow, TileGrid } from '@/features/shared/components';
import { useI18n } from '@/i18n';
import { Card, KeyValue, Section } from '@/ui/layout';
import { QueryScreen } from '@/ui/screen';
import { CardList, SeriesCharts } from '@/ui/data';
import { AnomalyList, InfraHeader, RelatedList } from './components';

export function InfraDetailScreen({ id }: { id: string }) {
  const query = useInfrastructureResource(id);
  return (
    <QueryScreen query={query} testID="infrastructure-resource-screen">
      {(resource) => <InfraBody resource={resource} />}
    </QueryScreen>
  );
}

function InfraBody({ resource }: { resource: InfraDetail }) {
  const { t } = useI18n();
  return (
    <>
      <Stack.Screen options={{ title: resource.name }} />
      <InfraHeader resource={resource} />

      {resource.anomalies.length ? (
        <Section title={t('infrastructure.anomaliesTitle')}>
          <AnomalyList anomalies={resource.anomalies} />
        </Section>
      ) : null}

      {resource.keyMetrics.length ? (
        <Section title={t('infrastructure.keyMetrics')}>
          <TileGrid>
            {resource.keyMetrics.map((m, i) => (
              <MetricTile key={`${m.label}-${i}`} label={m.label} value={m.value} testID={`infrastructure-metric-${i}`} />
            ))}
          </TileGrid>
        </Section>
      ) : null}

      {resource.series.length ? (
        <Section title={t('infrastructure.charts')}>
          <SeriesCharts series={resource.series} />
        </Section>
      ) : null}

      {resource.problems.length ? (
        <Section title={t('infrastructure.problems')}>
          <CardList items={resource.problems} keyOf={(p) => p.id} render={(p) => <ProblemRow problem={p} />} />
        </Section>
      ) : null}

      {resource.properties.length ? (
        <Section title={t('infrastructure.properties')}>
          <Card>
            {resource.properties.map((p, i) => (
              <KeyValue key={`${p.label}-${i}`} label={p.label} value={p.value} />
            ))}
          </Card>
        </Section>
      ) : null}

      {resource.related.length ? (
        <Section title={t('infrastructure.related')}>
          <RelatedList related={resource.related} />
        </Section>
      ) : null}
    </>
  );
}
