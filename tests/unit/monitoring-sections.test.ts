import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
      // D2's order, with one deviation recorded there: the brief is the section default once Task 17
      // builds it. Until then the default has to be a page that exists, so Problems leads.
      overview: ['brief', 'health', 'problems', 'insights', 'audit'],
      // Errors is its own section (D2), with the log sources it reads from beside the groups.
      errors: ['groups', 'sources'],
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

/** Where a section's sub-pages live. One `page.tsx` under here is what makes a segment real. */
const ROUTES = join(process.cwd(), 'src/app/[locale]/(app)/c/[connectionId]/[region]');

describe('the sub-pages no task has built yet', () => {
  it('names every segment that has no page, and only those — checked against the routes on disk', () => {
    /**
     * This used to be a hand-written list compared with itself, which could not notice the thing that
     * actually goes wrong: a page gets built and its "coming soon" line is left behind, so the menu keeps
     * refusing to link to a page that exists. So it reads the route files instead.
     */
    const hasPage = (section: string, subsection: string) =>
      existsSync(join(ROUTES, section, subsection, 'page.tsx'));

    const missing: string[] = [];
    const stale: string[] = [];
    for (const section of MONITORING_SECTIONS) {
      for (const subsection of subsectionsOf(section)) {
        const entry = `${section}/${subsection}`;
        const unbuilt = UNBUILT_SUBSECTIONS.includes(entry);
        if (unbuilt && hasPage(section, subsection)) stale.push(entry);
        if (!unbuilt && !hasPage(section, subsection)) missing.push(entry);
      }
    }

    // Marked "coming soon" while the page is right there.
    expect(stale).toEqual([]);
    // Linked from the menu with nothing behind it, which answers 404.
    expect(missing).toEqual([]);
  });

  it('only names segments the catalogue still has, so a rename cannot leave a stale entry', () => {
    for (const entry of UNBUILT_SUBSECTIONS) {
      const [section, subsection] = entry.split('/') as [never, string];
      expect(subsectionsOf(section), entry).toContain(subsection);
    }
  });

  it('marks a segment built or not', () => {
    expect(isSubsectionBuilt('databases', 'instances')).toBe(true);
    expect(isSubsectionBuilt('databases', 'queries')).toBe(true);
    expect(isSubsectionBuilt('logs', 'search')).toBe(true);
    expect(isSubsectionBuilt('logs', 'volume')).toBe(false);
  });

  it('never leaves a section pointing at a page that does not exist', () => {
    // `/<section>` and every connection or region switch land on the default segment, so it must be built.
    for (const section of MONITORING_SECTIONS) expect(isSubsectionBuilt(section, defaultSubsection(section)), section).toBe(true);
  });
});
