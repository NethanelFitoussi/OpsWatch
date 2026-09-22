import { describe, expect, it } from 'vitest';
import { isDbInstanceId, isEcsName, isLoadBalancerName } from '@/lib/monitoring/shared/names';
import {
  monitoringPath,
  parseMonitoringPath,
  permissionsPath,
  subsectionPath,
  switchConnectionPath,
  withRegion,
} from '@/lib/monitoring/shared/paths';

const scope = { connectionId: 'abc123def456', region: 'eu-west-1' };
const target = { connectionId: 'def456abc123', region: 'us-east-1' };

describe('monitoring paths', () => {
  it('builds section and resource paths', () => {
    expect(monitoringPath(scope, 'overview')).toBe('/c/abc123def456/eu-west-1/overview');
    expect(monitoringPath(scope, 'containers', 'prod', 'web')).toBe('/c/abc123def456/eu-west-1/containers/prod/web');
    expect(permissionsPath('abc123def456')).toBe('/accounts/abc123def456#permissions');
  });

  it('parses a pathname without its locale', () => {
    expect(parseMonitoringPath('/c/abc123def456/eu-west-1/load-balancers/my-alb')).toEqual({
      ...scope,
      section: 'load-balancers',
      subsection: null,
      segments: ['my-alb'],
    });
    expect(parseMonitoringPath('/c/abc123def456/eu-west-1/nope')).toEqual({ ...scope, section: null, subsection: null, segments: [] });
    expect(parseMonitoringPath('/accounts/abc123def456')).toBeNull();
    expect(parseMonitoringPath('/c/abc123def456')).toBeNull();
  });

  // Without a recognised sub-section the default one is used, so a switch never lands on a bare section.
  it('switches region or connection and keeps the section, defaulting the sub-page', () => {
    expect(withRegion('/c/abc123def456/eu-west-1/containers/prod/web', 'us-east-1')).toBe('/c/abc123def456/us-east-1/containers/services');
    expect(withRegion('/accounts', 'us-east-1')).toBe('/accounts');
    expect(switchConnectionPath('/c/abc123def456/eu-west-1/alarms', target)).toBe('/c/def456abc123/us-east-1/alarms/list');
    expect(switchConnectionPath('/accounts', target)).toBe('/c/def456abc123/us-east-1/overview/problems');
  });

  it('carries the filters of the current page into the new region', () => {
    expect(withRegion('/c/abc123def456/eu-west-1/alarms', 'us-east-1', 'state=ALARM&tt=1&q=web')).toBe(
      '/c/abc123def456/us-east-1/alarms/list?state=ALARM&tt=1&q=web',
    );
    expect(withRegion('/c/abc123def456/eu-west-1/logs', 'us-east-1', 'group=%2Fecs%2Fweb&prefix=%2Fecs&range=12h')).toBe(
      '/c/abc123def456/us-east-1/logs/search?group=%2Fecs%2Fweb&prefix=%2Fecs&range=12h',
    );
    // The resource is dropped with the section it belonged to, the query string is not.
    expect(withRegion('/c/abc123def456/eu-west-1/containers/prod/web', 'us-east-1', 'range=12h&q=web')).toBe(
      '/c/abc123def456/us-east-1/containers/services?range=12h&q=web',
    );
  });

  it('switches connection without leaving the account pages', () => {
    expect(switchConnectionPath('/accounts/abc123def456', target)).toBe('/accounts/def456abc123');
    expect(switchConnectionPath('/accounts/new', target)).toBe('/c/def456abc123/us-east-1/overview/problems');
    expect(switchConnectionPath('/c/abc123def456/eu-west-1/logs', target)).toBe('/c/def456abc123/us-east-1/logs/search');
  });
});

describe('sub-section paths', () => {
  const scope = { connectionId: 'abc123def456', region: 'eu-west-1' };

  it('builds a sub-page path and a resource path under it', () => {
    expect(subsectionPath(scope, 'databases', 'queries')).toBe('/c/abc123def456/eu-west-1/databases/queries');
    expect(subsectionPath(scope, 'containers', 'services', 'prod', 'web')).toBe('/c/abc123def456/eu-west-1/containers/services/prod/web');
    expect(subsectionPath(scope, 'load-balancers', 'list', 'api alb')).toBe('/c/abc123def456/eu-west-1/load-balancers/list/api%20alb');
  });

  it('parses the sub-section and the segments after it', () => {
    expect(parseMonitoringPath('/c/abc123def456/eu-west-1/containers/services/prod/web')).toEqual({
      connectionId: 'abc123def456', region: 'eu-west-1', section: 'containers', subsection: 'services', segments: ['prod', 'web'],
    });
    expect(parseMonitoringPath('/c/abc123def456/eu-west-1/databases')).toEqual({
      connectionId: 'abc123def456', region: 'eu-west-1', section: 'databases', subsection: null, segments: [],
    });
    // An unknown segment is not a sub-section; it is left in segments so the page can 404 on it.
    expect(parseMonitoringPath('/c/abc123def456/eu-west-1/databases/nope')).toEqual({
      connectionId: 'abc123def456', region: 'eu-west-1', section: 'databases', subsection: null, segments: ['nope'],
    });
    expect(parseMonitoringPath('/accounts/abc123def456')).toBeNull();
  });

  it('keeps the sub-page when the region changes, and drops the resource', () => {
    expect(withRegion('/c/abc123def456/eu-west-1/databases/queries', 'us-east-1', 'range=12h&group=user'))
      .toBe('/c/abc123def456/us-east-1/databases/queries?range=12h&group=user');
    expect(withRegion('/c/abc123def456/eu-west-1/containers/services/prod/web', 'us-east-1'))
      .toBe('/c/abc123def456/us-east-1/containers/services');
    // Without a sub-section the default one is used, so a switch never lands on a bare section.
    expect(withRegion('/c/abc123def456/eu-west-1/alarms', 'us-east-1')).toBe('/c/abc123def456/us-east-1/alarms/list');
  });

  it('keeps the sub-page when the connection changes', () => {
    expect(switchConnectionPath('/c/abc123def456/eu-west-1/logs/volume', { connectionId: 'zzz999', region: 'us-east-1' }))
      .toBe('/c/zzz999/us-east-1/logs/volume');
    expect(switchConnectionPath('/accounts/abc123def456', { connectionId: 'zzz999', region: 'us-east-1' })).toBe('/accounts/zzz999');
  });
});

describe('resource names in URLs', () => {
  it('accepts only AWS naming patterns', () => {
    expect(isEcsName('ecs-gigs-prod')).toBe(true);
    expect(isEcsName('seller_api')).toBe(true);
    expect(isEcsName('a/b')).toBe(false);
    expect(isEcsName('')).toBe(false);
    expect(isDbInstanceId('opswatch-e2e-db')).toBe(true);
    expect(isDbInstanceId('1db')).toBe(false);
    expect(isLoadBalancerName('opswatch-e2e-alb')).toBe(true);
    expect(isLoadBalancerName('-alb')).toBe(false);
    expect(isLoadBalancerName('a'.repeat(33))).toBe(false);
  });
});
