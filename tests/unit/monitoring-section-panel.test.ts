import { describe, expect, it } from 'vitest';
import { sectionLinks } from '@/components/monitoring/section-layout';

describe('sectionLinks', () => {
  const scope = { connectionId: 'abc123def456', region: 'eu-west-1' };

  it('lists every sub-page of the section, in order, keeping the shareable query string', () => {
    expect(sectionLinks(scope, 'databases', 'range=12h&sort=load:desc')).toEqual([
      { subsection: 'instances', href: '/c/abc123def456/eu-west-1/databases/instances?range=12h', comingSoon: false },
      { subsection: 'queries', href: '/c/abc123def456/eu-west-1/databases/queries?range=12h', comingSoon: false },
      { subsection: 'report', href: '/c/abc123def456/eu-west-1/databases/report?range=12h', comingSoon: false },
    ]);
  });

  it('drops sub-page-specific parameters and keeps only the time range', () => {
    // A sort or a facet belongs to one table; carrying it to a sibling page would filter the wrong thing.
    expect(sectionLinks(scope, 'alarms', 'state=ALARM&tt=1&range=3h')[0].href).toBe('/c/abc123def456/eu-west-1/alarms/list?range=3h');
  });

  it('carries nothing when there is no range', () => {
    expect(sectionLinks(scope, 'overview', '')).toEqual([
      { subsection: 'brief', href: '/c/abc123def456/eu-west-1/overview/brief', comingSoon: false },
      { subsection: 'health', href: '/c/abc123def456/eu-west-1/overview/health', comingSoon: false },
      { subsection: 'problems', href: '/c/abc123def456/eu-west-1/overview/problems', comingSoon: false },
      { subsection: 'insights', href: '/c/abc123def456/eu-west-1/overview/insights', comingSoon: false },
      { subsection: 'checkup', href: '/c/abc123def456/eu-west-1/overview/checkup', comingSoon: true },
    ]);
  });

  it('marks the sub-pages no task has built, so the menu disables them instead of linking to a 404', () => {
    expect(sectionLinks(scope, 'logs', '').map((link) => [link.subsection, link.comingSoon])).toEqual([
      ['search', false],
      ['volume', true],
      ['endpoints', true],
    ]);
  });
});
