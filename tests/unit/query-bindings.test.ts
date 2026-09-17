import { describe, expect, it } from 'vitest';
import { createQueryBindings } from '@/lib/monitoring/query-bindings';

const binding = { connectionId: 'abc123def456', region: 'eu-west-1', sessionId: 'session-a' };

describe('query bindings', () => {
  it('match only the same connection, region and session within 10 minutes', () => {
    let t = 0;
    const bindings = createQueryBindings({ now: () => t });
    bindings.bind('q1', binding);
    expect(bindings.matches('q1', binding)).toBe(true);
    expect(bindings.matches('q1', { ...binding, sessionId: 'session-b' })).toBe(false);
    expect(bindings.matches('q1', { ...binding, region: 'us-east-1' })).toBe(false);
    expect(bindings.matches('q1', { ...binding, connectionId: 'def456abc123' })).toBe(false);
    expect(bindings.matches('q2', binding)).toBe(false);
    t = 599_999;
    expect(bindings.matches('q1', binding)).toBe(true);
    t = 600_000;
    expect(bindings.matches('q1', binding)).toBe(false);
  });

  it('forgets on request and stays bounded', () => {
    const bindings = createQueryBindings({ maxEntries: 2 });
    bindings.bind('a', binding);
    bindings.bind('b', binding);
    bindings.bind('c', binding);
    expect(bindings.matches('a', binding)).toBe(false);
    expect(bindings.matches('c', binding)).toBe(true);
    bindings.forget('c');
    expect(bindings.matches('c', binding)).toBe(false);
  });
});
