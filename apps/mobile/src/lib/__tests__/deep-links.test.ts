import { isSafeId, parseDeepLink, routeForRef } from '../deep-links';

describe('parseDeepLink', () => {
  it('accepts allow-listed object links in every supported form', () => {
    expect(parseDeepLink('opswatch://problems/prb-checkout-5xx')).toBe('/problems/prb-checkout-5xx');
    expect(parseDeepLink('opswatch:///alerts/al-1')).toBe('/alerts/al-1');
    expect(parseDeepLink('/incidents/inc-2291')).toBe('/incidents/inc-2291');
    expect(parseDeepLink('opswatch://services/svc-a/')).toBe('/services/svc-a');
    expect(parseDeepLink('opswatch://errors/err%3Aabc')).toBe('/errors/err%3Aabc');
    expect(parseDeepLink('https://ops.example.com/m/problems/p1', { associatedDomain: 'ops.example.com' })).toBe('/problems/p1');
  });

  it('never turns a dot segment into a traversal', () => {
    // The URL parser collapses `..` (encoded or not) before the allow-list sees it, so these are the Problems list.
    expect(parseDeepLink('opswatch://problems/..')).toBe('/problems');
    expect(parseDeepLink('opswatch://problems/%2e%2e')).toBe('/problems');
    // Ids that reach a screen or a request from anywhere else are refused outright.
    expect(isSafeId('..')).toBe(false);
    expect(isSafeId('.')).toBe(false);
    expect(isSafeId('a.b')).toBe(true);
    expect(routeForRef({ type: 'problem', id: '..' })).toBeNull();
  });

  it('accepts top-level screens', () => {
    expect(parseDeepLink('opswatch://problems')).toBe('/problems');
    expect(parseDeepLink('/')).toBe('/');
    expect(parseDeepLink('opswatch://system')).toBe('/system');
  });

  /**
   * The allow-list is the point of this module, so adding a screen means adding it here too. Forgetting is silent:
   * the link resolves to nothing and the app opens Home, which reads as the link being wrong rather than unlisted.
   * This asserts that every top-level screen the app ships is reachable by link.
   */
  it('lists every top-level screen the app has', () => {
    const screens = ['/', '/problems', '/alerts', '/services', '/errors', '/incidents', '/synthetics', '/slos', '/deployments', '/logs', '/infrastructure', '/brief', '/search', '/ask', '/settings', '/system', '/checkup'];
    for (const screen of screens) expect(parseDeepLink(`opswatch:/${screen}`)).toBe(screen);
  });

  it('drops query strings and fragments so a link cannot carry tokens or pre-fill actions', () => {
    expect(parseDeepLink('opswatch://problems/p1?acknowledge=1#x')).toBe('/problems/p1');
  });

  it('refuses everything else', () => {
    expect(parseDeepLink('https://evil.example.com/m/problems/p1', { associatedDomain: 'ops.example.com' })).toBeNull();
    expect(parseDeepLink('https://ops.example.com/problems/p1', { associatedDomain: 'ops.example.com' })).toBeNull();
    expect(parseDeepLink('opswatch://settings/../../etc')).toBeNull();
    expect(parseDeepLink('opswatch://problems/a/b')).toBeNull();
    expect(parseDeepLink('opswatch://unknown/x')).toBeNull();
    expect(parseDeepLink('opswatch://logs/log-1')).toBeNull();
    expect(parseDeepLink('opswatch://problems/<script>')).toBeNull();
    expect(parseDeepLink('opswatch://problems/%E0%A4%A')).toBeNull();
    expect(parseDeepLink('javascript:alert(1)')).toBeNull();
    expect(parseDeepLink('opswatch://problems/%2E%2E%2Fservices')).toBeNull();
    expect(parseDeepLink('not a url')).toBeNull();
    expect(parseDeepLink(`opswatch://problems/${'a'.repeat(201)}`)).toBeNull();
  });
});

describe('routeForRef', () => {
  it('maps object types to routes and refuses unsafe ids', () => {
    expect(routeForRef({ type: 'deployment', id: 'dep-1' })).toBe('/deployments/dep-1');
    expect(routeForRef({ type: 'evidence', id: 'ev-1' })).toBe('/evidence/ev-1');
    expect(routeForRef({ type: 'log', id: 'log-1' })).toBeNull();
    expect(routeForRef({ type: 'problem', id: '../x' })).toBeNull();
    expect(isSafeId('abc:DEF_1.2~3-4')).toBe(true);
    expect(isSafeId('a b')).toBe(false);
  });
});
