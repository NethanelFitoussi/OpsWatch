import { describe, expect, it } from 'vitest';
import { MONITORING_SECTIONS } from '@/lib/monitoring/shared/paths';
import { SUBSECTIONS, SUBSECTION_ICONS, defaultSubsection, isSubsectionOf, subsectionLabelKey, subsectionsOf } from '@/lib/monitoring/shared/sections';

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
