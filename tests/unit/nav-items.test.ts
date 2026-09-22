import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, isNavActive, navHref } from '@/components/nav-items';

const item = (key: string) => NAV_ITEMS.find((i) => i.key === key)!;

describe('navigation items', () => {
  it('lists the monitoring sections first, then the guide, the settings and the accounts', () => {
    expect(NAV_ITEMS.map((i) => i.key)).toEqual([
      'overview',
      // Errors sits directly under the overview: it is the second thing anyone looks at.
      'errors',
      'containers',
      'databases',
      'loadBalancers',
      'alarms',
      'logs',
      'gettingStarted',
      'settings',
      'accounts',
    ]);
  });

  it('keeps the settings at the bottom, just above the accounts', () => {
    const keys = NAV_ITEMS.map((i) => i.key);
    expect(keys.indexOf('settings')).toBe(keys.indexOf('accounts') - 1);
    expect(navHref(item('settings'), '/c/abc123def456/eu-west-1/alarms')).toBe('/settings');
    expect(isNavActive(item('settings'), '/settings')).toBe(true);
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
