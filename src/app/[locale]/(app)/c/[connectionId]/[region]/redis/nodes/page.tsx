import { getTranslations } from 'next-intl/server';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { localizedTitle } from '@/i18n/metadata';
import { SEARCH_MAX } from '@/lib/limits';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow, parseTimeRange } from '@/lib/monitoring/shared/time-range';
import { RedisTable } from './table';

type Props = { params: Promise<MonitoringParams>; searchParams: Promise<{ range?: string | string[]; q?: string | string[] }> };

export const generateMetadata = localizedTitle('Monitoring.redis.nodesTitle');

export default async function RedisNodesPage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const sp = await searchParams;
  const range = parseTimeRange(sp.range, context.settings.defaultRange);
  const nowMs = pageNow();
  const search = ((Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? '').trim().slice(0, SEARCH_MAX);
  const t = await getTranslations('Monitoring.redis');

  return (
    <SectionLayout
      context={context}
      section="redis"
      subsection="nodes"
      range={range}
      filters={
        <form className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t('search')}
            <Input name="q" type="search" defaultValue={search} maxLength={SEARCH_MAX} />
          </label>
          <input type="hidden" name="range" value={range} />
          <Button type="submit">{t('searchSubmit')}</Button>
        </form>
      }
    >
      <SuspenseCard key={`${range}|${search}`} title={t('nodesTitle')} variant="table">
        <RedisTable scope={context.scope} range={range} nowMs={nowMs} search={search} />
      </SuspenseCard>
    </SectionLayout>
  );
}
