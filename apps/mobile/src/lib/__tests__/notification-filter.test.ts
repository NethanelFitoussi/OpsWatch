/**
 * The foreground filter is the only place the user's notification choices are honoured, so it must fail closed:
 * anything it cannot classify is not shown. A server that omits the category, or a newer one that invents a sixth,
 * must not be able to put a banner on a device whose owner switched notifications off.
 */
import { shouldPresent } from '../notifications';

const enabled = { enabled: true, minSeverity: 'warning' as const, categories: ['alert' as const, 'critical_problem' as const, 'recovery' as const] };

it('shows what the user asked for', () => {
  expect(shouldPresent(enabled, { category: 'alert', severity: 'critical' })).toBe(true);
  expect(shouldPresent(enabled, { category: 'alert', severity: 'warning' })).toBe(true);
  expect(shouldPresent(enabled, { category: 'recovery' })).toBe(true);
});

it('refuses what they did not', () => {
  expect(shouldPresent(enabled, { category: 'alert', severity: 'info' })).toBe(false);
  expect(shouldPresent(enabled, { category: 'incident', severity: 'critical' })).toBe(false);
  expect(shouldPresent({ ...enabled, enabled: false }, { category: 'alert', severity: 'critical' })).toBe(false);
});

it('refuses a payload it cannot classify, rather than showing it', () => {
  // No category at all, which is what an omitted field produces after `categoryOf`.
  expect(shouldPresent(enabled, { category: null, severity: 'critical' })).toBe(false);
  expect(shouldPresent({ ...enabled, enabled: false }, { category: null })).toBe(false);
});
