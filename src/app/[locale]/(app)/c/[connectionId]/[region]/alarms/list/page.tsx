import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { SEARCH_MAX } from '@/lib/limits';
import { parseAlarmFilter } from '@/lib/monitoring/alarms';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { AlarmsCard } from './cards';

type Props = {
  params: Promise<MonitoringParams>;
  searchParams: Promise<{
    state?: string | string[];
    tt?: string | string[];
    q?: string | string[];
    svc?: string | string[];
    recent?: string | string[];
  }>;
};

export const generateMetadata = localizedTitle('Monitoring.alarms.title');

export default async function AlarmsPage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const filter = parseAlarmFilter(await searchParams);
  // One clock for the page, so "changed recently" means the same thing in the filter and in every row.
  const nowMs = pageNow();
  const t = await getTranslations('Monitoring.alarms');
  return (
    <SectionLayout
      context={context}
      section="alarms"
      subsection="list"
      filters={
        <form className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t('filters.search')}
            <Input name="q" defaultValue={filter.search} maxLength={SEARCH_MAX} placeholder={t('filters.searchPlaceholder')} />
          </label>
          {/* State and service are links on the card, so a filtered view is shareable and the back
              button works. These hidden fields keep them when the text search is submitted. */}
          {filter.state !== 'all' && <input type="hidden" name="state" value={filter.state} />}
          {filter.service !== 'all' && <input type="hidden" name="svc" value={filter.service} />}
          {filter.recent && <input type="hidden" name="recent" value="1" />}
          {filter.showTargetTracking && <input type="hidden" name="tt" value="1" />}
          <Button type="submit">{t('filters.apply')}</Button>
        </form>
      }
    >
      <SuspenseCard key={JSON.stringify(filter)} title={t('cardTitle')} variant="table" rows={6}>
        <AlarmsCard scope={context.scope} filter={filter} nowMs={nowMs} />
      </SuspenseCard>
    </SectionLayout>
  );
}
