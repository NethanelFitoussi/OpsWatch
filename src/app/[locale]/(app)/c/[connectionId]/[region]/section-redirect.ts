import { redirect } from '@/i18n/navigation';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { subsectionPath, type MonitoringSection } from '@/lib/monitoring/shared/paths';
import { defaultSubsection } from '@/lib/monitoring/shared/sections';

type SearchParams = Record<string, string | string[] | undefined>;
type Props = { params: Promise<MonitoringParams>; searchParams: Promise<SearchParams> };

function queryString(searchParams: SearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, one);
  }
  return query.toString();
}

/**
 * The section root is not a page: it opens the section's first sub-page, keeping the query string.
 * Every section root is this page with its own constant, so they cannot drift apart.
 */
export function sectionRedirect(section: MonitoringSection) {
  return async function SectionRootPage({ params, searchParams }: Props) {
    // Session, connection and region first, exactly like a monitoring page, so an unknown selection still 404s.
    const context = await initMonitoringRoute(params);
    const query = queryString(await searchParams);
    const path = subsectionPath(context.scope, section, defaultSubsection(section));
    return redirect({ href: query ? `${path}?${query}` : path, locale: context.locale });
  };
}
