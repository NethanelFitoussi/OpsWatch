import { isOneOf } from '@/lib/type-guards';

export const MONITORING_SECTIONS = ['overview', 'containers', 'databases', 'load-balancers', 'alarms', 'logs'] as const;
export type MonitoringSection = (typeof MONITORING_SECTIONS)[number];
export type ScopeRef = { connectionId: string; region: string };
export type ParsedMonitoringPath = ScopeRef & { section: MonitoringSection | null; segments: string[] };

/** A path without locale prefix, for next-intl's Link and redirect. */
export function monitoringPath(scope: ScopeRef, section: MonitoringSection, ...segments: string[]): string {
  return ['', 'c', scope.connectionId, scope.region, section, ...segments].map(encodeURIComponent).join('/');
}

/** Parses next-intl's usePathname() value (no locale prefix). */
export function parseMonitoringPath(pathname: string): ParsedMonitoringPath | null {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== 'c' || parts.length < 3) return null;
  const section = isOneOf(MONITORING_SECTIONS, parts[3]) ? parts[3] : null;
  return { connectionId: parts[1], region: parts[2], section, segments: section ? parts.slice(4) : [] };
}

/**
 * Resources differ per region, so only the section is kept; the query string (time range, filters,
 * searches, log group selection) rides along, exactly as the time range selector keeps it.
 */
export function withRegion(pathname: string, region: string, search = ''): string {
  const parsed = parseMonitoringPath(pathname);
  const path = parsed ? monitoringPath({ connectionId: parsed.connectionId, region }, parsed.section ?? 'overview') : pathname;
  return search ? `${path}?${search}` : path;
}

/** An account page of one connection: `/accounts/<id>`, not the list and not the creation form. */
function accountPageId(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  return parts.length === 2 && parts[0] === 'accounts' && parts[1] !== 'new' ? parts[1] : null;
}

/** From an account page the switch stays in the admin flow; from a monitoring page it keeps the section. */
export function switchConnectionPath(pathname: string, target: ScopeRef): string {
  const parsed = parseMonitoringPath(pathname);
  if (!parsed && accountPageId(pathname) !== null) return `/accounts/${encodeURIComponent(target.connectionId)}`;
  return monitoringPath(target, parsed?.section ?? 'overview');
}

export function permissionsPath(connectionId: string): string {
  return `/accounts/${connectionId}#permissions`;
}
