import { getTranslations } from 'next-intl/server';
import type React from 'react';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import { parseQueryGroup, parseQuerySort, QUERY_SORTS } from '@/lib/analysis/queries';
import { PI_GROUPS } from '@/lib/monitoring/pi';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { pageNow, parseTimeRange } from '@/lib/monitoring/shared/time-range';
import { cn } from '@/lib/utils';
import { FleetQueriesCard } from './cards';

type SearchParams = Record<string, string | string[] | undefined>;
type Props = { params: Promise<MonitoringParams>; searchParams: Promise<SearchParams> };

export const generateMetadata = localizedTitle('Sections.databases.queries');

const linkClass = (active: boolean) =>
  cn(
    'rounded-md px-2 py-1 text-xs whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring',
    active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
  );

export default async function DatabaseQueriesPage({ params, searchParams }: Props): Promise<React.JSX.Element> {
  const context = await initMonitoringRoute(params);
  const sp = await searchParams;
  const range = parseTimeRange(sp.range, context.settings.defaultRange);
  const group = parseQueryGroup(sp.group);
  const sort = parseQuerySort(sp.sort);
  // One clock for the whole page: every card below shares the same window, and with it its cache entries.
  const nowMs = pageNow();
  const t = await getTranslations('Monitoring.queries');
  const path = subsectionPath(context.scope, 'databases', 'queries');

  /**
   * One query parameter rewritten, every other kept exactly as it arrived: the grouping and the sort are
   * plain links, so the view stays shareable and the back button undoes a change of either.
   */
  const hrefWith = (key: string, value: string) => {
    const next = new URLSearchParams();
    for (const [name, raw] of Object.entries(sp)) {
      if (raw === undefined) continue;
      for (const item of Array.isArray(raw) ? raw : [raw]) next.append(name, item);
    }
    next.set(key, value);
    return `${path}?${next.toString()}`;
  };

  const filters = (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs font-medium">{t('groupBy.label')}</span>
          {PI_GROUPS.map((value) => (
            <Link key={value} href={hrefWith('group', value)} aria-current={value === group ? 'page' : undefined} className={linkClass(value === group)}>
              {t(`groupBy.${value}`)}
            </Link>
          ))}
        </div>
        {/* Each grouping is a separate Performance Insights call per instance, so the page shows one at a time. */}
        <p className="text-xs text-muted-foreground">{t('groupBy.note')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs font-medium">{t('sortBy.label')}</span>
        {QUERY_SORTS.map((value) => (
          <Link key={value} href={hrefWith('sort', value)} aria-current={value === sort ? 'page' : undefined} className={linkClass(value === sort)}>
            {t(`sortBy.${value}`)}
          </Link>
        ))}
      </div>
    </div>
  );

  return (
    // No auto-refresh: every refresh would spend one Performance Insights call per instance.
    <SectionLayout
      context={context}
      section="databases"
      subsection="queries"
      description={t('description')}
      range={range}
      autoRefresh={false}
      filters={filters}
    >
      <SuspenseCard key={`${range}|${group}|${sort}`} title={t('cardTitle')} variant="table" rows={8}>
        <FleetQueriesCard scope={context.scope} group={group} sort={sort} range={range} nowMs={nowMs} />
      </SuspenseCard>
    </SectionLayout>
  );
}
