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
      // Ask OpsWatch sits last: §2.2 puts the deterministic surfaces first and the assistant after them.
      overview: ['brief', 'health', 'problems', 'alerts', 'incidents', 'synthetics', 'insights', 'checkup', 'ask'],
      // Errors is its own section (D2), with the log sources it reads from beside the groups.
      errors: ['groups', 'sources'],
      // DEP-3's deployment history sits with the services it shipped to.
      containers: ['services', 'deployments', 'report'],
      databases: ['instances', 'queries', 'report'],
      // §19's objectives sit with the load balancers they are measured on, between the list and the report.
      'load-balancers': ['list', 'objectives', 'report'],
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
    expect(isSubsectionOf('databases', 'checkup')).toBe(false);
    expect(isSubsectionOf('databases', undefined)).toBe(false);
    expect(isSubsectionOf('databases', '')).toBe(false);
  });
  it('names one message key and one icon per segment', () => {
    expect(subsectionLabelKey('logs', 'volume')).toBe('Sections.logs.volume');
    for (const section of MONITORING_SECTIONS) {
      for (const sub of subsectionsOf(section)) expect(SUBSECTION_ICONS[sub]).toBeDefined();
    }
  });

  it('THE RULING: no two sub-pages of one section share an icon, because collapsed the icon is the entry', () => {
    for (const section of MONITORING_SECTIONS) {
      const icons = subsectionsOf(section).map((sub) => SUBSECTION_ICONS[sub]);
      expect(new Set(icons).size, `${section}: ${icons.join()}`).toBe(icons.length);
    }
  });

  it('lets two sections reuse one icon, because they are never on screen together', () => {
    // Both are a plain list; one is a set of ECS services and the other a set of RDS instances.
    expect(SUBSECTION_ICONS.services).toBe(SUBSECTION_ICONS.instances);
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
    // Every segment in the catalogue is built today, which is what an empty UNBUILT_SUBSECTIONS means.
    for (const section of MONITORING_SECTIONS) {
      for (const subsection of subsectionsOf(section)) {
        expect(isSubsectionBuilt(section, subsection), `${section}/${subsection}`).toBe(true);
      }
    }
    expect(UNBUILT_SUBSECTIONS).toEqual([]);
  });

  it('answers from the live list, so the treatment returns the moment a segment is added to it', () => {
    for (const section of MONITORING_SECTIONS) {
      for (const subsection of subsectionsOf(section)) {
        expect(isSubsectionBuilt(section, subsection)).toBe(!UNBUILT_SUBSECTIONS.includes(`${section}/${subsection}`));
      }
    }
  });

  it('never leaves a section pointing at a page that does not exist', () => {
    // `/<section>` and every connection or region switch land on the default segment, so it must be built.
    for (const section of MONITORING_SECTIONS) expect(isSubsectionBuilt(section, defaultSubsection(section)), section).toBe(true);
  });
});
