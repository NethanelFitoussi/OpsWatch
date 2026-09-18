import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, isNavActive, navHref } from '@/components/nav-items';

const item = (key: string) => NAV_ITEMS.find((i) => i.key === key)!;

describe('navigation items', () => {
  it('lists the monitoring sections first, all enabled', () => {
    expect(NAV_ITEMS.map((i) => i.key)).toEqual(['overview', 'containers', 'databases', 'loadBalancers', 'alarms', 'logs', 'gettingStarted', 'accounts']);
  });

  it('keeps the selected connection and region in monitoring links, opening the section default sub-page', () => {
    expect(navHref(item('containers'), '/c/abc123def456/eu-west-1/alarms')).toBe('/c/abc123def456/eu-west-1/containers/services');
    expect(navHref(item('loadBalancers'), '/accounts')).toBe('/load-balancers');
    expect(navHref(item('accounts'), '/c/abc123def456/eu-west-1/alarms')).toBe('/accounts');
  });

  it('marks the current section active', () => {
    expect(isNavActive(item('containers'), '/c/abc123def456/eu-west-1/containers/prod/web')).toBe(true);
    expect(isNavActive(item('overview'), '/c/abc123def456/eu-west-1/containers')).toBe(false);
    expect(isNavActive(item('accounts'), '/accounts/abc123def456')).toBe(true);
    expect(isNavActive(item('alarms'), '/alarms')).toBe(true);
  });
});
