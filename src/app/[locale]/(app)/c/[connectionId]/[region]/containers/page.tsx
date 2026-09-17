import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MonitoringHeader } from '@/components/monitoring/monitoring-header';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { SEARCH_MAX } from '@/lib/limits';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow, parseTimeRange } from '@/lib/monitoring/shared/time-range';
import { ClusterSections } from './cards';

type Props = {
  params: Promise<MonitoringParams>;
  searchParams: Promise<{ range?: string | string[]; q?: string | string[] }>;
};

export const generateMetadata = localizedTitle('Monitoring.containers.title');

export default async function ContainersPage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const sp = await searchParams;
  const range = parseTimeRange(sp.range);
  // One clock for the whole page: every card below shares the same window, and with it its cache entries.
  const nowMs = pageNow();
  const search = ((Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? '').trim().slice(0, SEARCH_MAX);
  const t = await getTranslations('Monitoring.containers');
  return (
    <div className="space-y-6">
      <MonitoringHeader
        context={context}
        title={t('title')}
        description={t('description', { connection: context.connection.name, region: context.scope.region })}
        range={range}
      />
      <form className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t('search.label')}
          <Input name="q" type="search" defaultValue={search} maxLength={SEARCH_MAX} />
        </label>
        <input type="hidden" name="range" value={range} />
        <Button type="submit">{t('search.submit')}</Button>
      </form>
      <SuspenseCard key={`${range}|${search}`} title={t('clustersTitle')} variant="table">
        <ClusterSections scope={context.scope} range={range} nowMs={nowMs} search={search} />
      </SuspenseCard>
    </div>
  );
}
