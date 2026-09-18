import type { MonitoringSection } from './paths';

/**
 * The second menu of §1. The first segment of each section is its default, and `/<section>` redirects there.
 * These segments are URL vocabulary and are never translated; `Sections.<section>.<segment>` holds their labels.
 */
export const SUBSECTIONS = {
  overview: ['insights', 'audit'],
  containers: ['services', 'report'],
  databases: ['instances', 'queries', 'report'],
  'load-balancers': ['list', 'report'],
  alarms: ['list', 'report'],
  // Task 22 moves 'volume' to the front when the Logs dashboard exists; until then 'search' stays the default
  // so `/logs` never redirects to a page that does not exist yet.
  logs: ['search', 'volume', 'endpoints'],
} as const satisfies Record<MonitoringSection, readonly [string, ...string[]]>;

export type Subsection = (typeof SUBSECTIONS)[MonitoringSection][number];

export function subsectionsOf(section: MonitoringSection): readonly string[] {
  return SUBSECTIONS[section];
}

export function defaultSubsection(section: MonitoringSection): string {
  return subsectionsOf(section)[0];
}

export function isSubsectionOf(section: MonitoringSection, value: string | undefined): boolean {
  return value !== undefined && subsectionsOf(section).includes(value);
}

export function subsectionLabelKey(section: MonitoringSection, subsection: string): string {
  return `Sections.${section}.${subsection}`;
}

/** One icon per segment, so the collapsed section panel always has one to show. */
export const SUBSECTION_ICONS: Record<string, 'list' | 'report' | 'audit' | 'queries' | 'volume' | 'endpoints' | 'search' | 'insights'> = {
  insights: 'insights',
  audit: 'audit',
  services: 'list',
  instances: 'list',
  list: 'list',
  report: 'report',
  queries: 'queries',
  search: 'search',
  volume: 'volume',
  endpoints: 'endpoints',
};
