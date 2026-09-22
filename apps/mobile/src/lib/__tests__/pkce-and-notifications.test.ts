import { base64ToUrl, base64UrlFromBytes, readAuthRedirect } from '../pkce';
import { categoryOf, parseNotificationData, routeForNotification, shouldPresent } from '../notifications';

describe('OAuth redirect', () => {
  it('returns the code only when the state matches', () => {
    expect(readAuthRedirect('opswatch://auth/callback?code=abc&state=s1', 's1')).toEqual({ code: 'abc' });
    expect(readAuthRedirect('opswatch://auth/callback?code=abc&state=other', 's1')).toEqual({ error: 'state_mismatch' });
    expect(readAuthRedirect('opswatch://auth/callback?state=s1', 's1')).toEqual({ error: 'missing_code' });
    expect(readAuthRedirect('opswatch://auth/callback?error=access_denied&state=s1', 's1')).toEqual({ error: 'denied' });
    expect(readAuthRedirect(`opswatch://auth/callback?code=${'x'.repeat(600)}&state=s1`, 's1')).toEqual({ error: 'missing_code' });
  });

  it('encodes base64url without padding', () => {
    expect(base64ToUrl('a+b/c==')).toBe('a-b_c');
    expect(base64UrlFromBytes(new Uint8Array([251, 255]))).toBe('-_8');
  });
});

describe('notifications', () => {
  it('routes reference-only payloads through the allow-list', () => {
    expect(routeForNotification({ type: 'problem', id: 'prb-1', category: 'critical_problem' })).toBe('/problems/prb-1');
    expect(routeForNotification({ type: 'alert', id: 'al-1', env: 'prod' })).toBe('/alerts/al-1');
    expect(parseNotificationData({ type: 'incident', id: 'inc-1', env: 'bad env' })).toEqual({ type: 'incident', id: 'inc-1', env: undefined });
  });

  it('ignores anything that is not a known reference', () => {
    expect(routeForNotification(null)).toBeNull();
    expect(routeForNotification({ type: 'url', id: 'https://evil' })).toBeNull();
    expect(routeForNotification({ type: 'problem', id: '../../settings' })).toBeNull();
    expect(routeForNotification({ type: 'log', id: 'log-1' })).toBeNull();
    expect(categoryOf('marketing')).toBeNull();
  });

  it('applies the preferences: minimum severity and categories', () => {
    const criticalOnly = { minSeverity: 'critical' as const, categories: ['critical_problem' as const, 'alert' as const, 'recovery' as const] };
    expect(shouldPresent(criticalOnly, { category: 'alert', severity: 'critical' })).toBe(true);
    expect(shouldPresent(criticalOnly, { category: 'alert', severity: 'warning' })).toBe(false);
    expect(shouldPresent(criticalOnly, { category: 'incident', severity: 'critical' })).toBe(false);
    expect(shouldPresent(criticalOnly, { category: 'recovery' })).toBe(true);
    const all = { minSeverity: 'info' as const, categories: ['alert' as const] };
    expect(shouldPresent(all, { category: 'alert', severity: 'info' })).toBe(true);
  });
});
