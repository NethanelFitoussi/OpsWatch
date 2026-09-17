import { describe, expect, it } from 'vitest';
import { createLoginThrottle } from '@/lib/auth/login-throttle';

function fakeClock(start = 1_000_000) {
  const clock = {
    now: start,
    sleeps: [] as number[],
    read: () => clock.now,
    sleep: async (ms: number) => {
      clock.sleeps.push(ms);
      clock.now += ms;
    },
  };
  return clock;
}

function throttleWith(clock: ReturnType<typeof fakeClock>) {
  return createLoginThrottle({ now: clock.read, sleep: clock.sleep });
}

function fail(throttle: ReturnType<typeof createLoginThrottle>, times: number) {
  for (let i = 0; i < times; i++) throttle.recordFailure();
}

describe('login throttle', () => {
  it('verifies immediately while 20 or fewer sign-ins failed in the last minute', async () => {
    const clock = fakeClock();
    const throttle = throttleWith(clock);
    fail(throttle, 20);
    expect(await throttle.run(async () => 'first')).toEqual({ limited: false, value: 'first' });
    expect(await throttle.run(async () => 'second')).toEqual({ limited: false, value: 'second' });
    expect(clock.sleeps).toEqual([]);
  });

  it('spaces verifications by at least 3 seconds once more than 20 sign-ins failed', async () => {
    const clock = fakeClock();
    const throttle = throttleWith(clock);
    fail(throttle, 21);
    const startedAt: number[] = [];
    const verify = async () => {
      startedAt.push(clock.now);
      return true;
    };
    const results = await Promise.all([throttle.run(verify), throttle.run(verify), throttle.run(verify)]);
    expect(results.every((r) => !r.limited && r.value)).toBe(true);
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(3000);
    expect(startedAt[2] - startedAt[1]).toBeGreaterThanOrEqual(3000);
  });

  it('runs verifications one at a time during the slowdown', async () => {
    const clock = fakeClock();
    const throttle = throttleWith(clock);
    fail(throttle, 25);
    let running = 0;
    let maxRunning = 0;
    const verify = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await Promise.resolve();
      await Promise.resolve();
      running--;
      return null;
    };
    await Promise.all(Array.from({ length: 5 }, () => throttle.run(verify)));
    expect(maxRunning).toBe(1);
  });

  it('still verifies after a verification throws', async () => {
    const clock = fakeClock();
    const throttle = throttleWith(clock);
    fail(throttle, 21);
    const failing = throttle.run(async () => {
      throw new Error('boom');
    });
    const next = throttle.run(async () => 'ok');
    await expect(failing).rejects.toThrow('boom');
    expect(await next).toEqual({ limited: false, value: 'ok' });
  });

  it('refuses when more than 50 attempts are already waiting', async () => {
    const clock = fakeClock();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const throttle = createLoginThrottle({ now: clock.read, sleep: () => gate });
    fail(throttle, 21);
    const queued = Array.from({ length: 51 }, () => throttle.run(async () => 'queued'));
    expect(await throttle.run(async () => 'refused')).toEqual({ limited: true });
    release();
    const settled = await Promise.all(queued);
    expect(settled.every((r) => !r.limited)).toBe(true);
  });

  it('ends the slowdown once the failures are more than a minute old', async () => {
    const clock = fakeClock();
    const throttle = throttleWith(clock);
    fail(throttle, 21);
    await throttle.run(async () => null);
    clock.now += 60_001;
    clock.sleeps = [];
    await throttle.run(async () => null);
    await throttle.run(async () => null);
    expect(clock.sleeps).toEqual([]);
  });
});
