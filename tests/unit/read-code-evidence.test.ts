import { describe, expect, it } from 'vitest';
import { readCodeEvidence, splitFrame, type FrameEvidence } from '@/lib/read/code-evidence';
import { recordError, upsertLogSource } from '@/lib/store/errors';
import { setMapping, upsertRepository } from '@/lib/store/repositories';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };

const seedGroup = (db: ReturnType<typeof createTestDb>, frames: string[], serviceId: string | null = 'prod/storefront') => {
  upsertLogSource(db, { ...env, logGroup: '/aws/ecs/web', serviceId, enabled: true, format: 'json', fieldMap: {} });
  return recordError(db, {
    ...env,
    logSourceId: 's1',
    serviceId,
    fingerprint: 'f'.repeat(32),
    fingerprintVersion: 1,
    exceptionType: 'TypeError',
    sampleMessage: 'boom',
    normalizedMessage: 'boom',
    topFrames: frames,
    at: NOW,
    count: 1,
    instances: 1,
  });
};

describe('reading a stored frame', () => {
  it('splits it at the last colon, so a path with colons survives', () => {
    expect(splitFrame('/app/src/a.ts:charge')).toEqual({ file: '/app/src/a.ts', functionName: 'charge' });
    expect(splitFrame('src/a.ts:<2>')).toEqual({ file: 'src/a.ts', functionName: '<2>' });
  });

  it('answers a null function rather than an empty one', () => {
    expect(splitFrame('src/a.ts')).toEqual({ file: 'src/a.ts', functionName: null });
  });
});

describe('§13 — a mapping is offered, never applied', () => {
  it('THE RULING: with no mapping it suggests, and the state says it is a suggestion', () => {
    const db = createTestDb();
    upsertRepository(db, { owner: 'acme', name: 'storefront' }, NOW);
    const group = seedGroup(db, ['/app/src/pay.ts:charge']);

    const evidence = readCodeEvidence(db, group);
    // Not 'mapped': nothing has been decided, and the panel must ask rather than assume.
    expect(evidence.state).toBe('suggested');
    if (evidence.state === 'suggested') expect(evidence.repository.name).toBe('storefront');
  });

  it('links the frames once somebody has accepted it', () => {
    const db = createTestDb();
    const repository = upsertRepository(db, { owner: 'acme', name: 'storefront' }, NOW);
    const group = seedGroup(db, ['/app/src/pay.ts:charge']);
    setMapping(db, { ...env, serviceId: 'prod/storefront', repositoryId: repository.id }, NOW);

    const evidence = readCodeEvidence(db, group);
    expect(evidence.state).toBe('mapped');
    if (evidence.state === 'mapped') {
      expect(evidence.frames[0]?.path).toBe('src/pay.ts');
      expect(evidence.frames[0]?.url).toBe('https://github.com/acme/storefront/blob/main/src/pay.ts');
    }
  });

  it('says there is nothing to suggest rather than showing an empty panel', () => {
    const db = createTestDb();
    const group = seedGroup(db, ['/app/src/pay.ts:charge']);
    const evidence = readCodeEvidence(db, group);
    expect(evidence).toMatchObject({ state: 'unmapped', hasRepositories: false });
  });

  it('distinguishes "no repositories at all" from "none of them matched"', () => {
    const db = createTestDb();
    upsertRepository(db, { owner: 'acme', name: 'totally-unrelated' }, NOW);
    const group = seedGroup(db, ['/app/src/pay.ts:charge']);
    // The remedy differs: add a repository, or map this service by hand.
    expect(readCodeEvidence(db, group)).toMatchObject({ state: 'unmapped', hasRepositories: true });
  });

  it('cannot suggest for a group with no service, because there is nothing to match on', () => {
    const db = createTestDb();
    upsertRepository(db, { owner: 'acme', name: 'storefront' }, NOW);
    const group = seedGroup(db, ['/app/src/pay.ts:charge'], null);
    expect(readCodeEvidence(db, group).state).toBe('unmapped');
  });
});

describe('§J — what the panel can and cannot place', () => {
  it('THE RULING: a dependency frame gets no link, and is counted as not placed', () => {
    const db = createTestDb();
    const repository = upsertRepository(db, { owner: 'acme', name: 'storefront' }, NOW);
    const group = seedGroup(db, ['/app/src/pay.ts:charge', '/app/node_modules/pg/client.js:query']);
    setMapping(db, { ...env, serviceId: 'prod/storefront', repositoryId: repository.id }, NOW);

    const evidence = readCodeEvidence(db, group);
    if (evidence.state !== 'mapped') throw new Error('expected mapped');
    expect(evidence.frames).toHaveLength(2);
    expect(evidence.frames[1]?.url).toBeNull();
    // Stated, so a panel showing one link out of two does not look like the whole stack.
    expect(evidence.placed).toBe(1);
  });

  it('every frame carries the fields the panel needs to render it honestly', () => {
    const db = createTestDb();
    const repository = upsertRepository(db, { owner: 'acme', name: 'storefront' }, NOW);
    const group = seedGroup(db, ['/app/src/pay.ts:charge', '/app/node_modules/pg/client.js:query']);
    setMapping(db, { ...env, serviceId: 'prod/storefront', repositoryId: repository.id }, NOW);

    const evidence = readCodeEvidence(db, group);
    if (evidence.state !== 'mapped') throw new Error('expected mapped');
    for (const frame of evidence.frames satisfies FrameEvidence[]) {
      // A frame either has a path and a link, or neither — never a link to a path it could not resolve.
      expect(frame.path === null).toBe(frame.url === null);
      expect(typeof frame.raw).toBe('string');
    }
  });

  it('THE RULING: with no commit the ref is the branch and is marked as moving', () => {
    const db = createTestDb();
    const repository = upsertRepository(db, { owner: 'acme', name: 'storefront', defaultBranch: 'trunk' }, NOW);
    const group = seedGroup(db, ['/app/src/pay.ts:charge']);
    setMapping(db, { ...env, serviceId: 'prod/storefront', repositoryId: repository.id }, NOW);

    const evidence = readCodeEvidence(db, group);
    if (evidence.state !== 'mapped') throw new Error('expected mapped');
    // §13: a frame without a commit is a guess about line numbers, and the page has to say so.
    expect(evidence.frames[0]).toMatchObject({ ref: 'trunk', refIsMoving: true });
  });

  it('applies a monorepo prefix', () => {
    const db = createTestDb();
    const repository = upsertRepository(db, { owner: 'acme', name: 'mono' }, NOW);
    const group = seedGroup(db, ['/app/src/pay.ts:charge']);
    setMapping(db, { ...env, serviceId: 'prod/storefront', repositoryId: repository.id, pathPrefix: 'services/pay' }, NOW);

    const evidence = readCodeEvidence(db, group);
    if (evidence.state !== 'mapped') throw new Error('expected mapped');
    expect(evidence.frames[0]?.path).toBe('services/pay/src/pay.ts');
  });
});
