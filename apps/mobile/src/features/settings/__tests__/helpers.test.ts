import type { Environment } from '@/api/contract';
import { buildNumberOf, chooseEnvironment, effectiveEnvironmentId, groupFavorites, registrationMessage } from '../helpers';

const prod: Environment = { id: 'prod', name: 'Production', kind: 'production' };
const staging: Environment = { id: 'staging', name: 'Staging', kind: 'staging' };

describe('buildNumberOf', () => {
  const config = { version: '1.0.0', ios: { buildNumber: '12' }, android: { versionCode: 34 } };
  it('reads the platform build number', () => {
    expect(buildNumberOf(config, 'ios')).toBe('12');
    expect(buildNumberOf(config, 'android')).toBe('34');
    expect(buildNumberOf(config, 'web')).toBeNull();
    expect(buildNumberOf(null, 'ios')).toBeNull();
  });
});

describe('registrationMessage', () => {
  it('explains every outcome', () => {
    expect(registrationMessage({ ok: true })).toBe('notifications.registered');
    expect(registrationMessage({ ok: false, reason: 'denied' })).toBe('notifications.permissionDenied');
    expect(registrationMessage({ ok: false, reason: 'server_unsupported' })).toBe('notifications.serverUnsupported');
    expect(registrationMessage({ ok: false, reason: 'not_device' })).toBe('notifications.notPhysicalDevice');
    expect(registrationMessage({ ok: false, reason: 'no_project' })).toBe('notifications.noProject');
    expect(registrationMessage({ ok: false, reason: 'web' })).toBe('notifications.webUnsupported');
    expect(registrationMessage({ ok: false, reason: 'failed' })).toBe('notifications.registerFailed');
  });
});

describe('environments', () => {
  it('falls back to production, then the first environment', () => {
    expect(effectiveEnvironmentId([staging, prod], null)).toBe('prod');
    expect(effectiveEnvironmentId([staging, prod], 'staging')).toBe('staging');
    expect(effectiveEnvironmentId([staging], 'gone')).toBe('staging');
    expect(effectiveEnvironmentId([], null)).toBeNull();
  });

  it('requires a second tap to switch to production', () => {
    expect(chooseEnvironment(prod, 'staging', null)).toEqual({ action: 'confirm' });
    expect(chooseEnvironment(prod, 'staging', 'prod')).toEqual({ action: 'select' });
    expect(chooseEnvironment(staging, 'prod', null)).toEqual({ action: 'select' });
    expect(chooseEnvironment(prod, 'prod', null)).toEqual({ action: 'none' });
  });
});

describe('groupFavorites', () => {
  it('groups by type in a fixed order', () => {
    const groups = groupFavorites([
      { type: 'view', id: 'v', label: 'V' },
      { type: 'service', id: 's', label: 'S' },
      { type: 'synthetic', id: 'y', label: 'Y' },
    ]);
    expect(groups.map((g) => g.type)).toEqual(['service', 'synthetic', 'view']);
  });
});
