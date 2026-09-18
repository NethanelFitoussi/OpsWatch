import { getTranslations } from 'next-intl/server';
import { SECTION_NAV_KEY } from '@/components/nav-items';
import type { MonitoringPageContext } from '@/lib/monitoring/route';
import { subsectionPath, type MonitoringSection, type ScopeRef } from '@/lib/monitoring/shared/paths';
import { isSubsectionBuilt, subsectionsOf } from '@/lib/monitoring/shared/sections';
import type { TimeRange } from '@/lib/monitoring/shared/time-range';
import { SectionPanel } from './section-panel';
import { SectionPageHeader } from './section-page-header';

/**
 * The section menu's entries. Only the time range follows a move between sub-pages: a sort, a facet or a
 * search belongs to one table, and carrying it to a sibling page would filter the wrong thing. A sub-page
 * no task has built yet is marked `comingSoon`, and the menu shows it disabled rather than linking to a 404.
 */
export function sectionLinks(
  scope: ScopeRef,
  section: MonitoringSection,
  search: string,
): { subsection: string; href: string; comingSoon: boolean }[] {
  const range = new URLSearchParams(search).get('range');
  const query = range ? `?range=${encodeURIComponent(range)}` : '';
  return subsectionsOf(section).map((subsection) => ({
    subsection,
    href: `${subsectionPath(scope, section, subsection)}${query}`,
    comingSoon: !isSubsectionBuilt(section, subsection),
  }));
}

/**
 * Every monitoring sub-page: the section menu beside the content from 1024 px (above it, as a strip,
 * below that), the page header on top and an optional filters row between the header and the content.
 */
export async function SectionLayout({
  context,
  section,
  subsection,
  title,
  description,
  range,
  ranges,
  autoRefresh,
  headerActions,
  filters,
  children,
}: {
  context: MonitoringPageContext;
  section: MonitoringSection;
  subsection: string;
  title?: string;
  description?: string;
  range?: TimeRange;
  ranges?: readonly TimeRange[];
  autoRefresh?: boolean;
  headerActions?: React.ReactNode;
  filters?: React.ReactNode;
  children: React.ReactNode;
}) {
  const nav = await getTranslations('Common.nav');
  const sections = await getTranslations('Sections');
  const links = sectionLinks(context.scope, section, range ? `range=${range}` : '').map((link) => ({
    ...link,
    label: sections(`${section}.${link.subsection}`),
  }));

  return (
    <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start">
      <div className="min-w-0 lg:col-start-2 lg:row-start-1">
        <SectionPageHeader
          context={context}
          section={section}
          subsection={subsection}
          title={title}
          description={description}
          range={range}
          ranges={ranges}
          autoRefresh={autoRefresh}
          actions={headerActions}
        />
      </div>
      {/* Second in the document below 1024 px — a strip between the header and the filters — and the
          left column from there up, where it spans the header and the content. */}
      <div className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
        <SectionPanel sectionLabel={nav(SECTION_NAV_KEY[section])} subsection={subsection} links={links} />
      </div>
      <div className="min-w-0 space-y-6 lg:col-start-2 lg:row-start-2">
        {filters && <div className="rounded-md border p-3">{filters}</div>}
        {children}
      </div>
    </div>
  );
}
