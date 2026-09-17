export type ThrottleResult<T> = { limited: true } | { limited: false; value: T };

export type LoginThrottle = {
  /** Runs one password verification, slowed down while sign-ins are failing globally. */
  run<T>(verify: () => Promise<T>): Promise<ThrottleResult<T>>;
  recordFailure(): void;
};

export type LoginThrottleOptions = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** The slowdown starts when more than this many sign-ins failed within `windowMs`. */
  failureThreshold?: number;
  windowMs?: number;
  /** Minimum time between two password verifications during the slowdown. */
  minIntervalMs?: number;
  /** Attempts beyond this many queued (or in progress) during the slowdown are refused. */
  maxWaiting?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Global defence against password guessing that cannot lock the admin out: instead of refusing
 * every sign-in once too many failed, it verifies passwords one at a time, a few seconds apart.
 * A correct password still works during an attack, it just waits its turn.
 */
export function createLoginThrottle(options: LoginThrottleOptions = {}): LoginThrottle {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const failureThreshold = options.failureThreshold ?? 20;
  const windowMs = options.windowMs ?? 60_000;
  const minIntervalMs = options.minIntervalMs ?? 3000;
  const maxWaiting = options.maxWaiting ?? 50;

  let failures: number[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  let waiting = 0;
  let lastVerificationAt = Number.NEGATIVE_INFINITY;

  function underAttack(): boolean {
    const t = now();
    failures = failures.filter((at) => t - at < windowMs);
    return failures.length > failureThreshold;
  }

  return {
    async run(verify) {
      if (!underAttack()) {
        lastVerificationAt = now();
        return { limited: false, value: await verify() };
      }
      if (waiting > maxWaiting) {
        return { limited: true };
      }
      waiting++;
      const turn = chain.then(async () => {
        const wait = lastVerificationAt + minIntervalMs - now();
        if (wait > 0) {
          await sleep(wait);
        }
        lastVerificationAt = now();
        return verify();
      });
      // The next attempt waits for this one to settle, whether it succeeded or threw.
      chain = turn.catch(() => undefined);
      try {
        return { limited: false, value: await turn };
      } finally {
        waiting--;
      }
    },
    recordFailure() {
      failures.push(now());
    },
  };
}
