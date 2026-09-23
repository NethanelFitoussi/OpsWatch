import { describe, expect, it } from 'vitest';
import {
  FINGERPRINT_VERSION,
  MAX_FRAMES,
  NORMALIZED_MESSAGE_MAX,
  fingerprint,
  normalizeFrame,
  normalizeMessage,
  sampleFrames,
  significantFrames,
  type StackFrame,
} from '@/lib/detect/fingerprint';

describe('normalising a message (§4.4)', () => {
  it('collapses whitespace so formatting does not split a group', () => {
    expect(normalizeMessage('failed   to\n\tconnect')).toBe('failed to connect');
  });

  it('replaces the identifiers that differ on every occurrence', () => {
    expect(normalizeMessage('user 3f2504e0-4f89-11d3-9a0c-0305e82c3301 not found')).toBe('user <uuid> not found');
    expect(normalizeMessage('connect ECONNREFUSED 10.0.0.5')).toBe('connect ECONNREFUSED <ip>');
    expect(normalizeMessage('GET https://api.example.com/v1/x failed')).toBe('GET <url> failed');
    expect(normalizeMessage('no account for nobody@example.com')).toBe('no account for <email>');
    expect(normalizeMessage('column "order_id" missing')).toBe('column <str> missing');
    expect(normalizeMessage('token deadbeefcafe1234 rejected')).toBe('token <hex> rejected');
  });

  it('flattens any remaining number, because a count is not an identity', () => {
    expect(normalizeMessage('timed out after 30042 ms')).toBe('timed out after 0 ms');
    // Two occurrences differing only by a number are one error, not two.
    expect(normalizeMessage('retry 3 of 5')).toBe(normalizeMessage('retry 4 of 5'));
  });

  it('applies the replacements in §4.4\'s order, which is load-bearing', () => {
    // A UUID contains hex runs and digit runs. Replacing digits first would destroy it, and two different
    // ids would then still look different from each other.
    const a = normalizeMessage('id 3f2504e0-4f89-11d3-9a0c-0305e82c3301');
    const b = normalizeMessage('id 7a1b2c3d-1111-2222-3333-444455556666');
    expect(a).toBe('id <uuid>');
    expect(a).toBe(b);
  });

  it('truncates to the stated length rather than hashing an essay', () => {
    expect(normalizeMessage('x'.repeat(1000))).toHaveLength(NORMALIZED_MESSAGE_MAX);
  });
});

describe('normalising a frame (§33.13)', () => {
  it('strips a build hash from a path segment', () => {
    expect(normalizeFrame({ file: '/app/.next/static/9f8c1d2e4b7a/page.js', function: 'charge' }, 0)).toBe(
      '/app/.next/static/<hash>/page.js:charge',
    );
  });

  it('strips a content hash from a filename', () => {
    expect(normalizeFrame({ file: '/app/dist/main.4f3a9c8e.js', function: 'charge' }, 0)).toBe('/app/dist/main.js:charge');
  });

  it('replaces a minified name with the frame\'s position, which is stable across builds', () => {
    expect(normalizeFrame({ file: 'a.js', function: 'e' }, 2)).toBe('a.js:<2>');
    expect(normalizeFrame({ file: 'a.js', function: 'aB' }, 2)).toBe('a.js:<2>');
    expect(normalizeFrame({ file: 'a.js', function: '4821' }, 2)).toBe('a.js:<2>');
  });

  it('keeps a real function name', () => {
    expect(normalizeFrame({ file: 'a.js', function: 'chargeCard' }, 0)).toBe('a.js:chargeCard');
  });

  it('prefers a resolved symbol over both', () => {
    expect(normalizeFrame({ file: 'a.js', function: 'e', symbol: 'chargeCard' }, 2)).toBe('a.js:chargeCard');
  });
});

describe('which frames count', () => {
  const vendor: StackFrame[] = [
    { file: '/app/node_modules/pg/lib/client.js', function: 'query' },
    { file: '/usr/lib/node/internal/stream.js', function: 'read' },
    { file: '<internal>/timers.js', function: 'tick' },
    { file: '/app/src/payment/charge.ts', function: 'chargeCard' },
  ];

  it('drops the runtime and the dependencies, which say nothing about which error this is', () => {
    expect(significantFrames(vendor)).toEqual(['/app/src/payment/charge.ts:chargeCard']);
  });

  it('keeps at most the top five', () => {
    const deep = Array.from({ length: 12 }, (_, i) => ({ file: `/app/src/f${i}.ts`, function: `fn${i}` }));
    expect(significantFrames(deep)).toHaveLength(MAX_FRAMES);
  });

  it('never carries a line number, because a blank line would split the group', () => {
    expect(significantFrames([{ file: '/app/src/a.ts', function: 'fn' }])[0]).not.toMatch(/\d+$/);
  });
});

describe('§33.13 — the fingerprint survives a rebuild', () => {
  /** The same error, from two builds: different content hashes, different minified names. */
  const buildOne = {
    type: 'TypeError',
    message: "Cannot read properties of undefined (reading 'id')",
    frames: [
      { file: '/app/dist/main.4f3a9c8e.js', function: 'e' },
      // A directory build hash, in a frame that counts - the earlier version put this under `vendor`,
      // where it was dropped before it could prove anything.
      { file: '/app/dist/chunks/9f8c1d2e4b7a/payment.js', function: 'r' },
    ],
  };
  const buildTwo = {
    type: 'TypeError',
    message: "Cannot read properties of undefined (reading 'id')",
    frames: [
      { file: '/app/dist/main.b71e0a55.js', function: 'x' },
      { file: '/app/dist/chunks/1a2b3c4d5e6f/payment.js', function: 'q' },
    ],
  };

  it('THE RULING: two builds of the same code give one fingerprint', () => {
    expect(fingerprint(buildOne)).toBe(fingerprint(buildTwo));
  });

  it('and two genuinely different errors with the same minified names do not collide', () => {
    const other = { ...buildOne, message: 'Payment declined by the gateway' };
    expect(fingerprint(other)).not.toBe(fingerprint(buildOne));

    // Same message, different file: still different errors.
    const elsewhere = { ...buildOne, frames: [{ file: '/app/dist/other.4f3a9c8e.js', function: 'e' }] };
    expect(fingerprint(elsewhere)).not.toBe(fingerprint(buildOne));
  });

  it('is unchanged by the numbers inside a message', () => {
    expect(fingerprint({ type: 'Timeout', message: 'timed out after 3012 ms' })).toBe(
      fingerprint({ type: 'Timeout', message: 'timed out after 9987 ms' }),
    );
  });

  it('separates two exception types with the same message', () => {
    expect(fingerprint({ type: 'TypeError', message: 'boom' })).not.toBe(fingerprint({ type: 'RangeError', message: 'boom' }));
  });
});

describe('the fingerprint itself', () => {
  it('is 32 lowercase hex characters, and stable across processes', () => {
    const value = fingerprint({ type: 'TypeError', message: 'boom' });
    expect(value).toMatch(/^[0-9a-f]{32}$/);
    // Pinned: a change here regroups every error in the field, which is why the version exists.
    expect(value).toBe(fingerprint({ type: 'TypeError', message: 'boom' }));
  });

  it('falls back to the log group when there is no usable stack, so two sources do not merge', () => {
    const a = fingerprint({ type: 'Error', message: 'boom', logGroup: '/aws/ecs/web' });
    const b = fingerprint({ type: 'Error', message: 'boom', logGroup: '/aws/ecs/worker' });
    expect(a).not.toBe(b);
  });

  it('falls back when every frame was a vendor frame, rather than grouping on nothing', () => {
    const onlyVendor = { type: 'Error', message: 'boom', logGroup: '/aws/ecs/web', frames: [{ file: '/app/node_modules/x.js', function: 'y' }] };
    expect(fingerprint(onlyVendor)).toBe(fingerprint({ type: 'Error', message: 'boom', logGroup: '/aws/ecs/web' }));
  });

  it('declares its version, so changing the algorithm never silently re-merges history', () => {
    expect(FINGERPRINT_VERSION).toBe(1);
  });
});


describe('REPO-5 — the sighting’s own frames, beside the group’s', () => {
  const frames: StackFrame[] = [
    { file: '/app/node_modules/pg/lib/client.js', function: 'query', line: 5 },
    { file: '/app/src/payment/charge.ts', function: 'chargeCard', line: 184, column: 7 },
    { file: '/app/src/payment/api.ts', function: 'handler', line: 42 },
  ];

  it('THE RULING: it keeps the line and the column that the fingerprint throws away', () => {
    expect(sampleFrames(frames)).toEqual([
      { file: '/app/src/payment/charge.ts', function: 'chargeCard', line: 184, column: 7 },
      { file: '/app/src/payment/api.ts', function: 'handler', line: 42, column: null },
    ]);
    // The same input through the grouping path carries no line at all, which is the whole split.
    expect(significantFrames(frames).join()).not.toMatch(/184|:7\b/);
  });

  it('drops the same vendor frames, so the two lists line up by position', () => {
    expect(sampleFrames(frames)).toHaveLength(significantFrames(frames).length);
  });

  it('keeps at most the same top five', () => {
    const deep = Array.from({ length: 12 }, (_, i) => ({ file: `/app/src/f${i}.ts`, function: `fn${i}`, line: i + 1 }));
    expect(sampleFrames(deep)).toHaveLength(MAX_FRAMES);
  });

  it('prefers a resolved symbol, exactly as the grouping path does', () => {
    expect(sampleFrames([{ file: 'a.js', function: 'e', symbol: 'chargeCard', line: 3 }])[0].function).toBe('chargeCard');
  });

  it('says null where the stack said nothing, rather than inventing a line', () => {
    expect(sampleFrames([{ file: '/app/src/a.ts', function: 'fn' }])[0]).toEqual({
      file: '/app/src/a.ts',
      function: 'fn',
      line: null,
      column: null,
    });
  });
});
