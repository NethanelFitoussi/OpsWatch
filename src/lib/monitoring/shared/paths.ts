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

/** Resources differ per region, so only the section is kept. */
export function withRegion(pathname: string, region: string): string {
  const parsed = parseMonitoringPath(pathname);
  return parsed ? monitoringPath({ connectionId: parsed.connectionId, region }, parsed.section ?? 'overview') : pathname;
}

export function switchConnectionPath(pathname: string, target: ScopeRef): string {
  return monitoringPath(target, parseMonitoringPath(pathname)?.section ?? 'overview');
}

export function permissionsPath(connectionId: string): string {
  return `/accounts/${connectionId}#permissions`;
}
