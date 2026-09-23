import { describe, expect, it } from 'vitest';
import { readCodeEvidence, splitFrame, type FrameEvidence } from '@/lib/read/code-evidence';
import { recordDeploymentCommits } from '@/lib/store/deployment-commits';
import { listDeployments, recordDeployments } from '@/lib/store/deployments';
import { pageErrorGroups, recordError, upsertLogSource } from '@/lib/store/errors';
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

/** A group on a mapped service, with one placeable frame. */
const mappedGroup = (db: ReturnType<typeof createTestDb>, over: { firstSeenAt: number }) => {
  const repository = upsertRepository(db, { owner: 'acme', name: 'web', defaultBranch: 'main' }, over.firstSeenAt);
  setMapping(db, { ...env, serviceId: 'prod/web', repositoryId: repository.id, source: 'declared' }, over.firstSeenAt);
  upsertLogSource(db, { ...env, logGroup: '/aws/ecs/web', serviceId: 'prod/web', enabled: true, format: 'json', fieldMap: {} });
  return recordError(db, {
    ...env,
    logSourceId: 's1',
    serviceId: 'prod/web',
    fingerprint: 'a'.repeat(32),
    fingerprintVersion: 1,
    exceptionType: 'TypeError',
    sampleMessage: 'boom',
    normalizedMessage: 'boom',
    topFrames: ['/app/src/pay.ts:charge'],
    at: over.firstSeenAt,
    count: 1,
    instances: 1,
  });
};

const group = (db: ReturnType<typeof createTestDb>) => pageErrorGroups(db, env, null, 5).items[0];

describe('§13 — the reference a link points at', () => {
  const DEPLOY = Date.UTC(2026, 8, 23, 11, 40, 0);
  const FIRST_SEEN = DEPLOY + 12 * 60_000;

  const shipped = (db: ReturnType<typeof createTestDb>, over: { serviceId?: string; startedAt?: number } = {}) => {
    recordDeployments(
      db,
      { connectionId: 'c1', scope: 'us-east-1' },
      [
        {
          deploymentId: 'ecs-svc/1',
          serviceId: over.serviceId ?? 'prod/web',
          serviceName: 'web',
          cluster: 'prod',
          taskDefinition: 'web:42',
          status: 'completed',
          startedAt: over.startedAt ?? DEPLOY,
          updatedAt: (over.startedAt ?? DEPLOY) + 60_000,
          desiredCount: 1,
          runningCount: 1,
          failedTasks: 0,
        },
      ],
      FIRST_SEEN,
    );
    const stored = listDeployments(db, { connectionId: 'c1', scope: 'us-east-1' }, 5)[0];
    recordDeploymentCommits(
      db,
      [{ deploymentId: stored.id, sha: 'cafe1234', repository: 'acme/web', message: 'Change', author: 'Ada', at: DEPLOY, files: [] }],
      FIRST_SEEN,
    );
  };

  it('THE RULING: an error that followed a deployment is pinned to that deployment’s commit', () => {
    const db = createTestDb();
    mappedGroup(db, { firstSeenAt: FIRST_SEEN });
    shipped(db);

    const evidence = readCodeEvidence(db, group(db));
    expect(evidence.state).toBe('mapped');
    if (evidence.state !== 'mapped') return;
    // Immutable: the code that actually ran, rather than whatever the branch says today.
    expect(evidence.frames[0].ref).toBe('cafe1234');
    expect(evidence.frames[0].refIsMoving).toBe(false);
    expect(evidence.frames[0].url).toContain('cafe1234');
  });

  it('THE RULING: with no deployment behind it the link is a branch, and says it may have moved', () => {
    const db = createTestDb();
    mappedGroup(db, { firstSeenAt: FIRST_SEEN });

    const evidence = readCodeEvidence(db, group(db));
    if (evidence.state !== 'mapped') throw new Error('expected mapped');
    expect(evidence.frames[0].refIsMoving).toBe(true);
    expect(evidence.frames[0].ref).toBe('main');
  });

  it('a deployment of another service is not this code, however close in time', () => {
    const db = createTestDb();
    mappedGroup(db, { firstSeenAt: FIRST_SEEN });
    shipped(db, { serviceId: 'prod/worker' });

    const evidence = readCodeEvidence(db, group(db));
    if (evidence.state !== 'mapped') throw new Error('expected mapped');
    expect(evidence.frames[0].refIsMoving).toBe(true);
  });

  it('a deployment that started after the error cannot have shipped it', () => {
    const db = createTestDb();
    mappedGroup(db, { firstSeenAt: FIRST_SEEN });
    shipped(db, { startedAt: FIRST_SEEN + 60_000 });

    const evidence = readCodeEvidence(db, group(db));
    if (evidence.state !== 'mapped') throw new Error('expected mapped');
    expect(evidence.frames[0].refIsMoving).toBe(true);
  });

  it('a deployment whose commits were never fetched leaves the link on the branch', () => {
    const db = createTestDb();
    mappedGroup(db, { firstSeenAt: FIRST_SEEN });
    recordDeployments(
      db,
      { connectionId: 'c1', scope: 'us-east-1' },
      [
        {
          deploymentId: 'ecs-svc/2', serviceId: 'prod/web', serviceName: 'web', cluster: 'prod',
          taskDefinition: 'web:43', status: 'completed', startedAt: DEPLOY, updatedAt: DEPLOY,
          desiredCount: 1, runningCount: 1, failedTasks: 0,
        },
      ],
      FIRST_SEEN,
    );
    // Knowing a deployment happened is not knowing which commit it carried.
    const evidence = readCodeEvidence(db, group(db));
    if (evidence.state !== 'mapped') throw new Error('expected mapped');
    expect(evidence.frames[0].refIsMoving).toBe(true);
  });
});

describe('REPO-5 — a line, without line numbers entering identity', () => {
  const AT = Date.UTC(2026, 8, 23, 11, 55, 0);

  /** The same group, recorded with the raw sample a sighting carries. */
  const withSample = (db: ReturnType<typeof createTestDb>, line: number | null) => {
    const repository = upsertRepository(db, { owner: 'acme', name: 'web', defaultBranch: 'main' }, AT);
    setMapping(db, { ...env, serviceId: 'prod/web', repositoryId: repository.id, source: 'declared' }, AT);
    upsertLogSource(db, { ...env, logGroup: '/aws/ecs/web', serviceId: 'prod/web', enabled: true, format: 'json', fieldMap: {} });
    return recordError(db, {
      ...env,
      logSourceId: 's1',
      serviceId: 'prod/web',
      fingerprint: 'b'.repeat(32),
      fingerprintVersion: 1,
      exceptionType: 'TypeError',
      sampleMessage: 'boom',
      normalizedMessage: 'boom',
      topFrames: ['/app/src/pay.ts:charge'],
      sampleFrames: [{ file: '/app/src/pay.ts', function: 'charge', line, column: 7 }],
      at: AT,
      count: 1,
      instances: 1,
    });
  };

  const onlyFrame = (db: ReturnType<typeof createTestDb>) => {
    const evidence = readCodeEvidence(db, pageErrorGroups(db, env, null, 5).items[0]);
    if (evidence.state !== 'mapped') throw new Error('expected mapped');
    return evidence.frames[0];
  };

  it('THE RULING: the link points at the line the last sighting reported', () => {
    const db = createTestDb();
    withSample(db, 184);
    const frame = onlyFrame(db);
    expect(frame.line).toBe(184);
    expect(frame.url).toContain('#L184');
  });

  it('THE RULING: two sightings on different lines stay one group', () => {
    const db = createTestDb();
    withSample(db, 184);
    withSample(db, 203);
    // §4.4's promise: adding a blank line to a file must not split an error group in two.
    expect(pageErrorGroups(db, env, null, 5).items).toHaveLength(1);
    // And the sample moves with the error, so the link opens the line it is on now.
    expect(onlyFrame(db).line).toBe(203);
  });

  it('opens the file rather than guessing a line, when the stack carried none', () => {
    const db = createTestDb();
    withSample(db, null);
    const frame = onlyFrame(db);
    expect(frame.line).toBeNull();
    // `#L0` would point at nothing, which is worse than pointing at the file.
    expect(frame.url).not.toContain('#L');
  });

  it('THE RULING: a sample for a different file never lends its line to another frame', () => {
    const db = createTestDb();
    const repository = upsertRepository(db, { owner: 'acme', name: 'web', defaultBranch: 'main' }, AT);
    setMapping(db, { ...env, serviceId: 'prod/web', repositoryId: repository.id, source: 'declared' }, AT);
    upsertLogSource(db, { ...env, logGroup: '/aws/ecs/web', serviceId: 'prod/web', enabled: true, format: 'json', fieldMap: {} });
    recordError(db, {
      ...env,
      logSourceId: 's1',
      serviceId: 'prod/web',
      fingerprint: 'c'.repeat(32),
      fingerprintVersion: 1,
      exceptionType: 'TypeError',
      sampleMessage: 'boom',
      normalizedMessage: 'boom',
      topFrames: ['/app/src/pay.ts:charge'],
      // Misaligned on purpose: a line from the wrong frame is worse than no line at all.
      sampleFrames: [{ file: '/app/src/other.ts', function: 'other', line: 99, column: 1 }],
      at: AT,
      count: 1,
      instances: 1,
    });
    expect(onlyFrame(db).line).toBeNull();
  });

  it('a group recorded before the column existed still renders, without a line', () => {
    const db = createTestDb();
    mappedGroup(db, { firstSeenAt: AT });
    expect(onlyFrame(db).line).toBeNull();
  });
});
