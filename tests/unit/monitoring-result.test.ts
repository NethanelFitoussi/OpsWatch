import { describe, expect, it } from 'vitest';
import { isDeniedErrorCode } from '@/lib/aws/errors';
import { attempt, isFailure, toFailure } from '@/lib/monitoring/result';

const error = (name: string) => Object.assign(new Error(name), { name });

describe('monitoring results', () => {
  it('classifies denied, throttled and other AWS errors', () => {
    expect(toFailure('ecs:ListClusters', error('AccessDeniedException'))).toEqual({ ok: false, reason: 'denied', code: 'AccessDeniedException', action: 'ecs:ListClusters' });
    expect(toFailure('pi:DescribeDimensionKeys', error('NotAuthorizedException')).reason).toBe('denied');
    for (const code of ['Throttling', 'ThrottlingException', 'TooManyRequestsException', 'RequestLimitExceeded', 'LimitExceededException']) {
      expect(toFailure('x', error(code)).reason).toBe('throttled');
    }
    expect(toFailure('x', error('TimeoutError'))).toMatchObject({ reason: 'error', code: 'Timeout' });
    expect(toFailure('x', error('AbortError'))).toMatchObject({ reason: 'error', code: 'Timeout' });
    expect(toFailure('x', 'boom')).toMatchObject({ reason: 'error', code: 'UnknownError' });
  });

  it('wraps a call', async () => {
    expect(await attempt('x', async () => 42)).toEqual({ ok: true, data: 42 });
    expect(await attempt('x', async () => Promise.reject(error('AccessDenied')))).toMatchObject({ ok: false, reason: 'denied' });
    expect(isFailure({ ok: false, reason: 'error', code: 'X', action: 'x' })).toBe(true);
    expect(isFailure({ ok: true, data: null })).toBe(false);
    expect(isFailure(undefined)).toBe(false);
  });

  it('shares the denied pattern with the permission test', () => {
    expect(isDeniedErrorCode('AccessDenied')).toBe(true);
    expect(isDeniedErrorCode('UnauthorizedOperation')).toBe(true);
    expect(isDeniedErrorCode('ThrottlingException')).toBe(false);
  });
});
