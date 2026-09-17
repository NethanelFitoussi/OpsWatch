import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '@/lib/auth/rate-limit';

describe('rate limiter', () => {
  it('allows 5 attempts per minute per key', () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
    for (let i = 0; i < 5; i++) {
      expect(limiter.attempt('1.2.3.4', 1_000 + i)).toBe(true);
    }
    expect(limiter.attempt('1.2.3.4', 1_010)).toBe(false);
    expect(limiter.attempt('5.6.7.8', 1_010)).toBe(true);
  });

  it('frees attempts once the window has passed', () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
    for (let i = 0; i < 5; i++) limiter.attempt('ip', 0);
    expect(limiter.attempt('ip', 59_999)).toBe(false);
    expect(limiter.attempt('ip', 60_001)).toBe(true);
  });

  it('reset clears a key', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.attempt('ip', 0);
    limiter.reset('ip');
    expect(limiter.attempt('ip', 1)).toBe(true);
  });

  it('forgets keys whose window has passed, so forged keys cannot grow memory forever', () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 3 });
    for (const key of ['a', 'b', 'c']) limiter.attempt(key, 0);
    expect(limiter.size()).toBe(3);
    limiter.attempt('d', 60_001);
    expect(limiter.size()).toBe(1);
  });
});
