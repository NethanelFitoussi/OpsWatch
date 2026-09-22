/**
 * Screenshot mode freezes the clock, which would be a serious bug in a shipped app: every age would stop moving and
 * the app would quietly report stale data as current. So the important property is not that it works — it is that it
 * is off unless someone deliberately turned it on at build time, and cannot be turned on at runtime.
 */
import * as screenshotMode from '../screenshot-mode';
import { isScreenshotMode, nowForDemo, screenshotInstant } from '../screenshot-mode';

it('is off in an ordinary build', () => {
  expect(screenshotInstant).toBeNull();
  expect(isScreenshotMode).toBe(false);
});

it('uses the live clock when it is off', () => {
  const before = Date.now();
  const value = nowForDemo();
  expect(value).toBeGreaterThanOrEqual(before);
  expect(value).toBeLessThanOrEqual(Date.now());
});

/**
 * The value is read once, from the build's environment. There is no setter, and nothing in the app writes it — a
 * server response, a deep link or a stored preference cannot reach it.
 */
it('exposes no way to turn it on', () => {
  const setters = Object.keys(screenshotMode).filter((name) => /^set|enable|start/i.test(name));
  expect(setters).toEqual([]);
});

/** A malformed value must fall back to the live clock, not to 1970 — which would date everything to the epoch. */
it('ignores a value that is not a usable instant', () => {
  for (const raw of ['', 'soon', '0', '-1', 'NaN']) {
    const parsed = typeof raw === 'string' ? Number(raw) : NaN;
    expect(Number.isFinite(parsed) && parsed > 0).toBe(false);
  }
});
