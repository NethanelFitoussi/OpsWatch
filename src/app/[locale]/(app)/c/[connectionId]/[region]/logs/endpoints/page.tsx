import { getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { readSources } from '@/lib/read/log-sources';
import { runEndpointsAction } from './actions';
import { EndpointsForm } from './endpoints-form';

type Props = { params: Promise<MonitoringParams> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Monitoring.endpoints.title');

/**
 * Logs → Endpoints: the slowest routes, from the application's own logs (§3b).
 *
 * CloudWatch cannot answer this — a load balancer reports latency for a whole target group and never per
 * path — so this is the one page that needs a field mapping, and the one whose *rendering* would otherwise
 * scan gigabytes. So it loads with nothing queried, states what a query costs, and runs when asked.
 */
export default async function EndpointsPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  const t = await getTranslations('Monitoring.endpoints');
  const { connectionId, region } = { connectionId: context.scope.connectionId, region: context.scope.region };

  const view = readSources(
    getDb(),
    { connectionId, scope: region },
    { nowMs: pageNow(), budgetGbPerDay: env().OPSWATCH_LOGS_BUDGET_GB_PER_DAY },
  );
  const enabled = view.sources.filter((source) => source.enabled);
  // If a source already maps a route field for error collection, offer it rather than asking twice.
  const mapped = enabled.find((source) => (source.fields.route ?? '') !== '');

  return (
    <SectionLayout context={context} section="logs" subsection="endpoints">
      <MonitoringCard title={t('title')} description={t('description')}>
        <p className="text-sm text-muted-foreground">{t('whyLogs')}</p>
      </MonitoringCard>

      <EndpointsForm
        action={runEndpointsAction.bind(null, context.locale, connectionId, region)}
        enabledSources={enabled.map((source) => source.logGroup)}
        budget={view.budget}
        suggested={
          mapped === undefined
            ? null
            : { routeField: (mapped.fields.route ?? 'route').replace(/^\$\.?/, ''), durationField: 'duration' }
        }
      />
    </SectionLayout>
  );
}
