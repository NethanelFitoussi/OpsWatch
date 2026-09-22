import { describe, expect, it } from 'vitest';
import { CORRELATION_WINDOW_MS, DEPLOYMENT_WINDOW_MS, correlateDeployments } from '@/lib/detect/correlate';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const MINUTE = 60_000;
const deploy = (serviceId: string, minutesAgo: number) => ({ serviceId, startedAt: NOW - minutesAgo * MINUTE, id: `${serviceId}@${minutesAgo}` });
const problem = { serviceId: 'prod/web', firstSeenAt: NOW };

describe('§7 — what may be called a correlation', () => {
  it('measures the gap in minutes, which is the whole statement', () => {
    const [first] = correlateDeployments([deploy('prod/web', 8)], problem);
    expect(first).toMatchObject({ minutesBefore: 8, close: true });
  });

  it('THE RULING: a deployment after the problem started is not correlated with it', () => {
    // Showing it would invite exactly the reading §7 forbids, backwards.
    const later = { serviceId: 'prod/web', startedAt: NOW + 5 * MINUTE, id: 'later' };
    expect(correlateDeployments([later], problem)).toEqual([]);
  });

  it('THE RULING: a different service is not correlated, however close in time', () => {
    // Same service is §7's declared relation. Without it, everything in a busy account looks correlated.
    expect(correlateDeployments([deploy('prod/api', 1)], problem)).toEqual([]);
  });

  it('THE RULING: a problem with no service is correlated with nothing, not with everything', () => {
    // Guaranteed by the same-service filter, not by a separate guard — an early return for this was dead
    // code, which a mutation test showed by surviving its removal.
    expect(correlateDeployments([deploy('prod/web', 1)], { serviceId: null, firstSeenAt: NOW })).toEqual([]);
  });

  it('drops a deployment older than the window', () => {
    expect(correlateDeployments([deploy('prod/web', 31)], problem)).toEqual([]);
    expect(correlateDeployments([deploy('prod/web', 30)], problem)).toHaveLength(1);
  });

  it('marks the tighter window, so a reader can tell eight minutes from twenty-eight', () => {
    const [close, far] = correlateDeployments([deploy('prod/web', 2), deploy('prod/web', 28)], problem);
    expect(close?.close).toBe(true);
    expect(far?.close).toBe(false);
    expect(CORRELATION_WINDOW_MS).toBe(15 * MINUTE);
    expect(DEPLOYMENT_WINDOW_MS).toBe(30 * MINUTE);
  });

  it('puts the nearest first, because that is the change a reader looks at first', () => {
    const list = correlateDeployments([deploy('prod/web', 25), deploy('prod/web', 3), deploy('prod/web', 12)], problem);
    expect(list.map((one) => one.minutesBefore)).toEqual([3, 12, 25]);
  });

  it('counts a deployment at the same instant as zero minutes before, not as excluded', () => {
    expect(correlateDeployments([deploy('prod/web', 0)], problem)).toMatchObject([{ minutesBefore: 0, close: true }]);
  });

  it('accepts a narrower window when a caller wants §7’s tighter one', () => {
    expect(correlateDeployments([deploy('prod/web', 20)], problem, CORRELATION_WINDOW_MS)).toEqual([]);
  });
});
