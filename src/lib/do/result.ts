/**
 * What a DigitalOcean connection's last test found.
 *
 * Its own type in its own file, so `schema.ts` can describe a JSON column without importing a
 * `server-only` module to do it.
 */
export type DoTestFailure = 'no_token' | 'unauthorized' | 'forbidden' | 'rate_limited' | 'unreachable' | 'error';

export type DoTestResult = {
  testedAt: number;
  /** Null when the read worked. Otherwise why, and how many droplets is then unknown rather than zero. */
  failure: DoTestFailure | null;
  /** How many droplets the token could see, where it could see them. */
  droplets: number | null;
};
