/**
 * Notification hardening: duplicates are suppressed, and a payload for another environment is recognised so the app
 * can switch to it before opening the object.
 */
import { dedupeKey, forgetSeenNotifications, isRepeat, parseNotificationData, routeForNotification } from '../notifications';

beforeEach(() => forgetSeenNotifications());

describe('duplicate suppression', () => {
  it('suppresses repeats inside the window, and the window slides with each delivery', () => {
    // Sliding is deliberate: a server retrying every few seconds stays suppressed for as long as it keeps retrying.
    const key = dedupeKey({ type: 'problem', id: 'prb-1' }, 'fallback');
    expect(isRepeat(key, 1_000)).toBe(false);
    expect(isRepeat(key, 5_000)).toBe(true);
    expect(isRepeat(key, 5_000 + 59_000)).toBe(true);
    expect(isRepeat(key, 5_000 + 59_000 + 60_001)).toBe(false);
  });

  it('keeps different objects, and different environments of one object, apart', () => {
    const now = 1_000;
    expect(isRepeat(dedupeKey({ type: 'problem', id: 'prb-1' }, 'a'), now)).toBe(false);
    expect(isRepeat(dedupeKey({ type: 'problem', id: 'prb-2' }, 'b'), now)).toBe(false);
    expect(isRepeat(dedupeKey({ type: 'problem', id: 'prb-1', env: 'staging' }, 'c'), now)).toBe(false);
    expect(isRepeat(dedupeKey({ type: 'problem', id: 'prb-1' }, 'a'), now)).toBe(true);
  });

  it('falls back to the platform identifier when the payload carries no usable reference', () => {
    expect(dedupeKey({ nonsense: true }, 'platform-id')).toBe('platform-id');
    expect(isRepeat('platform-id', 0)).toBe(false);
    expect(isRepeat('platform-id', 10)).toBe(true);
  });

  it('forgets old entries rather than growing without bound', () => {
    for (let i = 0; i < 200; i += 1) isRepeat(`k${i}`, i);
    // Everything above is older than the window at this point, so a fresh key is still not a repeat.
    expect(isRepeat('k199', 1_000_000)).toBe(false);
  });
});

describe('environment-aware targets', () => {
  it('reads the environment from the payload so the app can switch before navigating', () => {
    expect(parseNotificationData({ type: 'alert', id: 'al-1', env: 'prod-eu-west-1' })).toEqual({
      type: 'alert',
      id: 'al-1',
      env: 'prod-eu-west-1',
    });
    expect(routeForNotification({ type: 'alert', id: 'al-1', env: 'prod-eu-west-1' })).toBe('/alerts/al-1');
  });

  it('drops an environment id that is not safe, rather than trusting it', () => {
    expect(parseNotificationData({ type: 'alert', id: 'al-1', env: '../../etc' })?.env).toBeUndefined();
  });
});
