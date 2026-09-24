import { isOneOf } from '@/lib/type-guards';
import { defaultSubsection, isSubsectionOf } from './sections';

export const MONITORING_SECTIONS = ['overview', 'errors', 'containers', 'instances', 'databases', 'redis', 'load-balancers', 'alarms', 'logs'] as const;
export type MonitoringSection = (typeof MONITORING_SECTIONS)[number];
export type ScopeRef = { connectionId: string; region: string };
export type ParsedMonitoringPath = ScopeRef & { section: MonitoringSection | null; subsection: string | null; segments: string[] };

/** A path without locale prefix, for next-intl's Link and redirect. */
export function monitoringPath(scope: ScopeRef, section: MonitoringSection, ...segments: string[]): string {
  return ['', 'c', scope.connectionId, scope.region, section, ...segments].map(encodeURIComponent).join('/');
}

/** A sub-page path (and, optionally, a resource path under it): `/<section>/<subsection>/<...segments>`. */
export function subsectionPath(scope: ScopeRef, section: MonitoringSection, subsection: string, ...segments: string[]): string {
  return monitoringPath(scope, section, subsection, ...segments);
}

/**
 * Parses next-intl's usePathname() value (no locale prefix). `segments` is what remains after the
 * subsection: an unrecognised first segment is not consumed as a subsection, it stays in `segments` so
 * the page can 404 on it.
 */
export function parseMonitoringPath(pathname: string): ParsedMonitoringPath | null {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== 'c' || parts.length < 3) return null;
  const section = isOneOf(MONITORING_SECTIONS, parts[3]) ? parts[3] : null;
  const rest = section ? parts.slice(4) : [];
  const subsection = section && isSubsectionOf(section, rest[0]) ? rest[0] : null;
  return { connectionId: parts[1], region: parts[2], section, subsection, segments: subsection ? rest.slice(1) : rest };
}

/**
 * Resources differ per region, so only the section and sub-section are kept; the query string (time
 * range, filters, searches, log group selection) rides along, exactly as the time range selector keeps
 * it. Without a sub-section the default one is used, so a switch never lands on a bare section.
 */
export function withRegion(pathname: string, region: string, search = ''): string {
  const parsed = parseMonitoringPath(pathname);
  if (!parsed) return search ? `${pathname}?${search}` : pathname;
  const section = parsed.section ?? 'overview';
  const path = subsectionPath({ connectionId: parsed.connectionId, region }, section, parsed.subsection ?? defaultSubsection(section));
  return search ? `${path}?${search}` : path;
}

/** An account page of one connection: `/accounts/<id>`, not the list and not the creation form. */
function accountPageId(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  return parts.length === 2 && parts[0] === 'accounts' && parts[1] !== 'new' ? parts[1] : null;
}

/** From an account page the switch stays in the admin flow; from a monitoring page it keeps the sub-page. */
export function switchConnectionPath(pathname: string, target: ScopeRef): string {
  const parsed = parseMonitoringPath(pathname);
  if (!parsed && accountPageId(pathname) !== null) return `/accounts/${encodeURIComponent(target.connectionId)}`;
  const section = parsed?.section ?? 'overview';
  return subsectionPath(target, section, parsed?.subsection ?? defaultSubsection(section));
}

export function permissionsPath(connectionId: string): string {
  return `/accounts/${connectionId}#permissions`;
}
