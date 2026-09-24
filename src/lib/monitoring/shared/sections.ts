import type { MonitoringSection } from './paths';

/**
 * The second menu of §1. The first segment of each section is its default, and `/<section>` redirects there.
 * These segments are URL vocabulary and are never translated; `Sections.<section>.<segment>` holds their labels.
 */
export const SUBSECTIONS = {
  overview: ['brief', 'health', 'problems', 'alerts', 'incidents', 'synthetics', 'insights', 'checkup', 'ask'],
  errors: ['groups', 'sources'],
  containers: ['overview', 'services', 'deployments', 'report'],
  databases: ['instances', 'queries', 'report'],
  'load-balancers': ['list', 'objectives', 'report'],
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

/**
 * `<section>/<segment>` of every sub-page the plan still has to build. They stay in the catalogue so the
 * section menu shows where they will be, but the menu disables them and labels them "coming soon" rather
 * than linking to a page that answers "not found". This is the single list behind that treatment: the task
 * that builds a page deletes its line here and nothing else. A section's default segment is never in it.
 */
export const UNBUILT_SUBSECTIONS: readonly string[] = [
];

export function isSubsectionBuilt(section: MonitoringSection, subsection: string): boolean {
  return !UNBUILT_SUBSECTIONS.includes(`${section}/${subsection}`);
}

export function subsectionLabelKey(section: MonitoringSection, subsection: string): string {
  return `Sections.${section}.${subsection}`;
}

/**
 * One icon per segment, so the collapsed section panel always has one to show.
 *
 * Two segments of the same section must never share one: collapsed, the icon *is* the entry, and a menu
 * where Problems, Alerts and Incidents are the same triangle tells an operator nothing. Segments in
 * different sections may share freely — they are never on screen together. `monitoring-sections.test.ts`
 * holds both halves of that rule.
 */
export const SUBSECTION_ICONS: Record<
  string,
  | 'list'
  | 'report'
  | 'audit'
  | 'queries'
  | 'volume'
  | 'endpoints'
  | 'search'
  | 'insights'
  | 'problems'
  | 'health'
  | 'brief'
  | 'alerts'
  | 'incidents'
  | 'synthetics'
  | 'ask'
  | 'deployments'
  | 'sources'
  | 'estate'
> = {
  overview: 'estate',
  groups: 'list',
  sources: 'sources',
  problems: 'problems',
  health: 'health',
  brief: 'brief',
  insights: 'insights',
  checkup: 'audit',
  incidents: 'incidents',
  synthetics: 'synthetics',
  alerts: 'alerts',
  services: 'list',
  instances: 'list',
  list: 'list',
  report: 'report',
  objectives: 'health',
  deployments: 'deployments',
  ask: 'ask',
  queries: 'queries',
  search: 'search',
  volume: 'volume',
  endpoints: 'endpoints',
};
