import { describe, expect, it } from 'vitest';
import { MONITORING_SECTIONS } from '@/lib/monitoring/shared/paths';
import {
  SUBSECTIONS,
  SUBSECTION_ICONS,
  UNBUILT_SUBSECTIONS,
  defaultSubsection,
  isSubsectionBuilt,
  isSubsectionOf,
  subsectionLabelKey,
  subsectionsOf,
} from '@/lib/monitoring/shared/sections';

describe('the sub-section catalogue', () => {
  it('matches the spec table exactly', () => {
    expect(SUBSECTIONS).toEqual({
      overview: ['insights', 'audit'],
      containers: ['services', 'report'],
      databases: ['instances', 'queries', 'report'],
      'load-balancers': ['list', 'report'],
      alarms: ['list', 'report'],
      // Task 22 moves 'volume' to the front when the Logs dashboard exists; until then 'search' is the default.
      logs: ['search', 'volume', 'endpoints'],
    });
  });
  it('covers every section and gives each one a default', () => {
    for (const section of MONITORING_SECTIONS) {
      expect(subsectionsOf(section).length).toBeGreaterThan(0);
      expect(defaultSubsection(section)).toBe(subsectionsOf(section)[0]);
    }
    expect(defaultSubsection('databases')).toBe('instances');
    expect(defaultSubsection('load-balancers')).toBe('list');
  });
  it('recognises only its own segments', () => {
    expect(isSubsectionOf('databases', 'queries')).toBe(true);
    expect(isSubsectionOf('databases', 'audit')).toBe(false);
    expect(isSubsectionOf('databases', undefined)).toBe(false);
    expect(isSubsectionOf('databases', '')).toBe(false);
  });
  it('names one message key and one icon per segment', () => {
    expect(subsectionLabelKey('logs', 'volume')).toBe('Sections.logs.volume');
    for (const section of MONITORING_SECTIONS) {
      for (const sub of subsectionsOf(section)) expect(SUBSECTION_ICONS[sub]).toBeDefined();
    }
  });
});

describe('the sub-pages no task has built yet', () => {
  it('names every segment that has no page, and only those', () => {
    // One list drives the whole "coming soon" treatment: the task that builds a page deletes its line here.
    expect([...UNBUILT_SUBSECTIONS].sort()).toEqual([
      'alarms/report',
      'containers/report',
      'databases/queries',
      'databases/report',
      'load-balancers/report',
      'logs/endpoints',
      'logs/volume',
      'overview/audit',
    ]);
  });

  it('only names segments the catalogue still has, so a rename cannot leave a stale entry', () => {
    for (const entry of UNBUILT_SUBSECTIONS) {
      const [section, subsection] = entry.split('/') as [never, string];
      expect(subsectionsOf(section), entry).toContain(subsection);
    }
  });

  it('marks a segment built or not', () => {
    expect(isSubsectionBuilt('databases', 'instances')).toBe(true);
    expect(isSubsectionBuilt('databases', 'queries')).toBe(false);
    expect(isSubsectionBuilt('logs', 'search')).toBe(true);
    expect(isSubsectionBuilt('logs', 'volume')).toBe(false);
  });

  it('never leaves a section pointing at a page that does not exist', () => {
    // `/<section>` and every connection or region switch land on the default segment, so it must be built.
    for (const section of MONITORING_SECTIONS) expect(isSubsectionBuilt(section, defaultSubsection(section)), section).toBe(true);
  });
});
