/**
 * Screenshot mode: the demo, with time held still.
 *
 * Store screenshots have to be regenerable — a set captured today and a set captured next month must differ only
 * where the UI changed, or a reviewer cannot tell a layout regression from the clock moving. The demo dataset is
 * already deterministic given an instant (`buildDemoDataset(now)`), so the only thing that drifts is *which* instant,
 * and the relative times the screens compute from it ("4 min ago", "ongoing for 43 min").
 *
 * Setting `EXPO_PUBLIC_SCREENSHOT_AT` to an epoch in milliseconds pins both: the demo builds its dataset at that
 * instant and never rebuilds, and the shared clock stops there. Everything the screens derive then follows.
 *
 * This is not a second fake-data system: it is the same demo client and the same fixtures, given a fixed `now`.
 *
 * Unset — which is every build that is not being photographed — every function here returns null and nothing in the
 * app behaves differently. It cannot be turned on at runtime: the value is read from the build's public config.
 */
import Constants from 'expo-constants';

/**
 * Read from `process.env` first, because that is the only one that survives every build.
 *
 * Metro inlines `EXPO_PUBLIC_*` into the bundle at build time, on native and on web alike. `Constants.expoConfig` is
 * the other obvious place to put it and it works in development and in a native build — but a static web export
 * carries no embedded config, so the value silently vanished there and the "pinned" captures were being taken with a
 * live clock. It is kept as the fallback for anything that sets `extra` and not the environment.
 */
function configured(): number | null {
  const raw = process.env.EXPO_PUBLIC_SCREENSHOT_AT ?? Constants.expoConfig?.extra?.screenshotAt;
  const value = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  // A pinned instant must be a real one: a malformed value falls back to the live clock rather than to 1970.
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The instant this build pretends it is, or `null` for every ordinary build. */
export const screenshotInstant: number | null = configured();

export const isScreenshotMode = screenshotInstant !== null;

/** `Date.now`, or the pinned instant. The one place either is chosen. */
export function nowForDemo(): number {
  return screenshotInstant ?? Date.now();
}
