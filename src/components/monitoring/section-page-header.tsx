import { getTranslations } from 'next-intl/server';
import { SECTION_NAV_KEY } from '@/components/nav-items';
import type { MonitoringPageContext } from '@/lib/monitoring/route';
import { subsectionPath, type MonitoringSection } from '@/lib/monitoring/shared/paths';
import { defaultSubsection } from '@/lib/monitoring/shared/sections';
import type { TimeRange } from '@/lib/monitoring/shared/time-range';
import { AutoRefresh } from './auto-refresh';
import { MonitoringBreadcrumb } from './breadcrumb';
import { RegionSelector } from './region-selector';
import { TimeRangeSelector } from './time-range-selector';

/**
 * The header of a sub-page: where it sits, what it is called and every control the Stage 2 monitoring
 * header carried. The heading names the sub-page ("Queries"), because the section is already in the
 * breadcrumb; a page about one resource passes that resource's name as `title` instead.
 */
export async function SectionPageHeader({
  context,
  section,
  subsection,
  title,
  description,
  range,
  ranges,
  autoRefresh = true,
  actions,
}: {
  context: MonitoringPageContext;
  section: MonitoringSection;
  subsection: string;
  title?: string;
  description?: string;
  range?: TimeRange;
  ranges?: readonly TimeRange[];
  autoRefresh?: boolean;
  actions?: React.ReactNode;
}) {
  const nav = await getTranslations('Common.nav');
  const sections = await getTranslations('Sections');
  const subsectionLabel = sections(`${section}.${subsection}`);
  return (
    <div className="space-y-2">
      <MonitoringBreadcrumb
        sectionLabel={nav(SECTION_NAV_KEY[section])}
        connectionName={context.connection.name}
        subsectionLabel={subsectionLabel}
        sectionHref={subsectionPath(context.scope, section, defaultSubsection(section))}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title ?? subsectionLabel}</h1>
          {description && <p className="text-muted-foreground">{description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RegionSelector regions={context.connection.regions} current={context.scope.region} />
          {range && <TimeRangeSelector current={range} ranges={ranges} />}
          {autoRefresh && <AutoRefresh />}
          {actions}
        </div>
      </div>
    </div>
  );
}
