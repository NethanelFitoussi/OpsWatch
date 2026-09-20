/**
 * Service detail body: health and identity first, then the numbers, then what is wrong (problems, alerts), what it
 * runs on and depends on, and what changed (deployments).
 */
import { Stack, useRouter, type Href } from 'expo-router';
import type { ServiceDetail } from '@/api/contract';
import { useService } from '@/api/queries';
import { DeploymentRow } from '@/features/deployments/components';
import { AskAiButton, LinkRow, MetricTile, ProblemRow, TileGrid } from '@/features/shared/components';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { HealthBadge } from '@/ui/badges';
import { Button } from '@/ui/controls';
import { Card, Row, Section } from '@/ui/layout';
import { QueryScreen } from '@/ui/screen';
import { Text } from '@/ui/text';
import { CATEGORY_ICONS } from '../infrastructure/helpers';
import { AlertLine, ServiceHeader } from './components';
import { hasHttpMetrics } from './helpers';
import { CardList, SeriesCharts } from '@/ui/data';

const MAX_PROBLEMS = 5;

export function ServiceDetailScreen({ id }: { id: string }) {
  const query = useService(id);
  return (
    <QueryScreen query={query} testID="service-screen">
      {(service) => <ServiceBody service={service} />}
    </QueryScreen>
  );
}

function ServiceBody({ service }: { service: ServiceDetail }) {
  const { t } = useI18n();
  const router = useRouter();
  const openRef = useOpenRef();
  const problemsHref = `/problems?service=${encodeURIComponent(service.id)}` as Href;
  return (
    <>
      <Stack.Screen options={{ title: service.name }} />
      <ServiceHeader service={service} />

      <Section title={t('services.metrics')}>
        {hasHttpMetrics(service) ? (
          <TileGrid>
            <MetricTile label={t('metric.errorRate')} value={service.errorRate} testID="service-metric-errorRate" />
            <MetricTile label={t('metric.latencyP95')} value={service.latencyP95} testID="service-metric-latencyP95" />
            <MetricTile label={t('metric.requests')} value={service.requests} testID="service-metric-requests" />
          </TileGrid>
        ) : (
          <Card>
            <Text weight="600" testID="service-not-measured">
              {t('services.noHttpMetrics')}
            </Text>
            <Text variant="small" tone="muted">
              {t('services.noHttpMetricsHint')}
            </Text>
          </Card>
        )}
      </Section>

      {service.series.length ? (
        <Section title={t('services.charts')}>
          <SeriesCharts series={service.series} />
        </Section>
      ) : null}

      {/* Kept even when empty: "no open problems on this service" is the answer the on-call came for. */}
      <Section
        title={t('services.problems')}
        action={
          service.problems.length ? (
            <Button label={t('action.seeAll')} variant="ghost" compact onPress={() => router.push(problemsHref)} testID="service-see-all-problems" />
          ) : undefined
        }
      >
        {service.problems.length ? (
          <CardList items={service.problems.slice(0, MAX_PROBLEMS)} keyOf={(p) => p.id} render={(p) => <ProblemRow problem={p} />} />
        ) : (
          <Text tone="muted">{t('services.noProblems')}</Text>
        )}
      </Section>

      {service.alerts.length ? (
        <Section title={t('services.alerts')}>
          <CardList items={service.alerts} keyOf={(a) => a.id} render={(a) => <AlertLine alert={a} />} />
        </Section>
      ) : null}

      {service.infrastructure.length ? (
        <Section title={t('services.infrastructure')}>
          <CardList
            items={service.infrastructure}
            keyOf={(r) => r.id}
            render={(r) => (
              <Row
                testID={`service-resource-${r.id}`}
                title={r.name}
                subtitle={r.summary}
                icon={CATEGORY_ICONS[r.category]}
                right={<HealthBadge status={r.health} />}
                onPress={() => openRef({ type: 'infrastructure', id: r.id })}
              />
            )}
          />
        </Section>
      ) : null}

      {service.dependencies.length ? (
        <Section title={t('services.dependencies')}>
          <CardList
            items={service.dependencies}
            keyOf={(d) => `${d.ref.type}:${d.ref.id}`}
            render={(d) => (
              <Row
                testID={`service-dependency-${d.ref.id}`}
                title={d.ref.label ?? d.ref.id}
                subtitle={t(d.ref.type === 'service' ? 'services.dependencyType.service' : d.ref.type === 'infrastructure' ? 'services.dependencyType.infrastructure' : 'services.dependencyType.other')}
                icon={d.ref.type === 'service' ? 'apps-outline' : 'server-outline'}
                right={<HealthBadge status={d.health} />}
                onPress={() => openRef(d.ref)}
              />
            )}
          />
        </Section>
      ) : null}

      {service.deployments.length ? (
        <Section title={t('services.deployments')}>
          <CardList items={service.deployments} keyOf={(d) => d.id} render={(d) => <DeploymentRow deployment={d} showService={false} />} />
        </Section>
      ) : null}

      <Card padded={false}>
        <LinkRow href={`/errors?service=${encodeURIComponent(service.id)}`} title={t('services.errors')} subtitle={t('services.errorsHint')} icon="bug-outline" />
      </Card>

      <AskAiButton context={{ type: 'service', id: service.id }} label={t('services.analyze')} question={t('services.analyzeQuestion', { name: service.name })} />
    </>
  );
}
