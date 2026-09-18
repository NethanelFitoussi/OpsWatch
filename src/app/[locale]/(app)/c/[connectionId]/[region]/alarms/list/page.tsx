import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { SEARCH_MAX } from '@/lib/limits';
import { ALARM_STATE_FILTERS, parseAlarmFilter } from '@/lib/monitoring/alarms';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { AlarmsCard } from './cards';

type Props = {
  params: Promise<MonitoringParams>;
  searchParams: Promise<{ state?: string | string[]; tt?: string | string[]; q?: string | string[] }>;
};

export const generateMetadata = localizedTitle('Monitoring.alarms.title');

export default async function AlarmsPage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const filter = parseAlarmFilter(await searchParams);
  const t = await getTranslations('Monitoring.alarms');
  return (
    <SectionLayout
      context={context}
      section="alarms"
      subsection="list"
      filters={
        <form className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t('filters.state')}
            <select name="state" defaultValue={filter.state} className="h-9 rounded-md border bg-background px-2 text-sm">
              {ALARM_STATE_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {t(`filters.states.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="tt" value="1" defaultChecked={filter.showTargetTracking} />
            {t('filters.showTargetTracking')}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('filters.search')}
            <Input name="q" defaultValue={filter.search} maxLength={SEARCH_MAX} />
          </label>
          <Button type="submit">{t('filters.apply')}</Button>
        </form>
      }
    >
      <SuspenseCard key={JSON.stringify(filter)} title={t('cardTitle')} variant="table" rows={6}>
        <AlarmsCard scope={context.scope} filter={filter} />
      </SuspenseCard>
    </SectionLayout>
  );
}
