import { describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';
import type { SeenDeployment } from '@/lib/detect/deployment';

/**
 * §J's chain, closed: service → repository → deployment → commit → changed files (REPO-4).
 *
 * Every link existed before this and none of them met. The rulings are about the three ways the join can
 * be dishonest: fetching when there is no connection, reporting "nothing changed" for a deployment nobody
 * enriched, and turning a correlation into a cause.
 */

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const MINUTE = 60_000;
const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const env = { connectionId: 'c1', scope: 'us-east-1' };
const context = { nowMs: NOW, render: (key: string) => key };

vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: SECRET }) }));

const { ENRICH_PER_CYCLE, FIRST_DEPLOYMENT_WINDOW_MS, MAX_COMMITS, enrichDeployment, enrichRecent } = await import('@/lib/collector/deployment-code');
const { getDeployment } = await import('@/lib/read/deployments');
const { recordDeployments, listDeployments } = await import('@/lib/store/deployments');
const { listDeploymentCommits, previousDeploymentStart } = await import('@/lib/store/deployment-commits');
const { insertProblem } = await import('@/lib/store/problems');
const { saveGithubToken, testGithubConnection } = await import('@/lib/github/connection');
const { upsertRepository, setMapping } = await import('@/lib/store/repositories');

const seen = (over: Partial<SeenDeployment> = {}): SeenDeployment => ({
  deploymentId: 'ecs-svc/1',
  serviceId: 'prod/web',
  serviceName: 'web',
  cluster: 'prod',
  taskDefinition: 'web:42',
  status: 'completed',
  startedAt: NOW - 20 * MINUTE,
  updatedAt: NOW - 10 * MINUTE,
  desiredCount: 3,
  runningCount: 3,
  failedTasks: 0,
  ...over,
});

/** GitHub answering: `/user` for verification, a commit list, then one detail per commit. */
function github(commits: { sha: string; files?: number }[]) {
  return (async (url: string) => {
    if (url.endsWith('/user')) return new Response(JSON.stringify({ login: 'acme' }), { status: 200 });
    if (url.includes('/commits?')) {
      return new Response(
        JSON.stringify(commits.map((one) => ({ sha: one.sha, commit: { message: `Change ${one.sha}`, author: { name: 'Ada', date: new Date(NOW - 25 * MINUTE).toISOString() } } }))),
        { status: 200 },
      );
    }
    const sha = url.split('/commits/')[1] ?? '';
    const count = commits.find((one) => one.sha === sha)?.files ?? 1;
    return new Response(
      JSON.stringify({
        sha,
        commit: { message: `Change ${sha}`, author: { name: 'Ada', date: new Date(NOW - 25 * MINUTE).toISOString() } },
        files: Array.from({ length: count }, (_, i) => ({ filename: `src/pay-${i}.ts`, additions: 3, deletions: 1, status: 'modified' })),
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
}

async function connected(db: ReturnType<typeof createTestDb>) {
  saveGithubToken(db, 'ghp_token_value_0123456789abcdefgh', NOW);
  await testGithubConnection(db, NOW, { fetch: github([]) });
}

function mapped(db: ReturnType<typeof createTestDb>) {
  const repository = upsertRepository(db, { owner: 'acme', name: 'web', defaultBranch: 'main' }, NOW);
  setMapping(db, { ...env, serviceId: 'prod/web', repositoryId: repository.id, source: 'declared' }, NOW);
  return repository;
}

const only = (db: ReturnType<typeof createTestDb>) => listDeployments(db, env, 10)[0];

describe('THE RULING: nothing is fetched unless every link is there', () => {
  it('does nothing with no GitHub connection, and says which link is missing', async () => {
    const db = createTestDb();
    recordDeployments(db, env, [seen()], NOW);
    mapped(db);
    const sent = vi.fn();

    const result = await enrichDeployment(db, only(db), NOW, { fetch: sent as unknown as typeof fetch });
    expect(result).toEqual({ enriched: 0, commits: 0, skipped: 'not_connected' });
    expect(sent).not.toHaveBeenCalled();
  });

  it('does nothing when the service is not mapped to a repository', async () => {
    const db = createTestDb();
    await connected(db);
    recordDeployments(db, env, [seen()], NOW);

    const result = await enrichDeployment(db, only(db), NOW, { fetch: github([{ sha: 'a' }]) });
    expect(result.skipped).toBe('no_mapping');
    expect(listDeploymentCommits(db, only(db).id)).toEqual([]);
  });

  it('does not fetch a deployment twice', async () => {
    const db = createTestDb();
    await connected(db);
    mapped(db);
    recordDeployments(db, env, [seen()], NOW);

    await enrichDeployment(db, only(db), NOW, { fetch: github([{ sha: 'aaa' }]) });
    const again = await enrichDeployment(db, only(db), NOW, { fetch: github([{ sha: 'bbb' }]) });
    expect(again.skipped).toBe('already');
    expect(listDeploymentCommits(db, only(db).id).map((one) => one.sha)).toEqual(['aaa']);
  });
});

describe('the window a deployment’s commits come from', () => {
  it('THE RULING: it ends at the previous deployment, not at the repository’s beginning', () => {
    const db = createTestDb();
    recordDeployments(db, env, [seen({ deploymentId: 'old', startedAt: NOW - 3 * 60 * MINUTE })], NOW);
    recordDeployments(db, env, [seen({ deploymentId: 'new', startedAt: NOW - 20 * MINUTE })], NOW);

    expect(previousDeploymentStart(db, env, 'prod/web', NOW - 20 * MINUTE)).toBe(NOW - 3 * 60 * MINUTE);
    // The first deployment of a service has nothing before it, so a day is the bound rather than everything.
    expect(previousDeploymentStart(db, env, 'prod/web', NOW - 3 * 60 * MINUTE)).toBeNull();
    expect(FIRST_DEPLOYMENT_WINDOW_MS).toBe(24 * 60 * 60_000);
  });

  it('THE RULING: the request itself carries the window, so it cannot quietly become the whole history', async () => {
    const db = createTestDb();
    await connected(db);
    mapped(db);
    recordDeployments(db, env, [seen({ deploymentId: 'old', startedAt: NOW - 3 * 60 * MINUTE })], NOW);
    recordDeployments(db, env, [seen({ deploymentId: 'new', startedAt: NOW - 20 * MINUTE })], NOW);

    const urls: string[] = [];
    const watching = (async (url: string, init: RequestInit) => {
      urls.push(url);
      return github([{ sha: 'abc' }])(url, init);
    }) as unknown as typeof fetch;

    const newest = listDeployments(db, env, 10).find((one) => one.deploymentId === 'new');
    await enrichDeployment(db, newest!, NOW, { fetch: watching });

    const listing = urls.find((url) => url.includes('/commits?')) ?? '';
    // From the previous deployment, not from the epoch: "what shipped" is between two rollouts.
    expect(listing).toContain(`since=${encodeURIComponent(new Date(NOW - 3 * 60 * MINUTE).toISOString())}`);
    expect(listing).toContain(`until=${encodeURIComponent(new Date(NOW - 20 * MINUTE).toISOString())}`);
  });

  it('is bounded in commits as well as in time', async () => {
    const db = createTestDb();
    await connected(db);
    mapped(db);
    recordDeployments(db, env, [seen()], NOW);

    const many = Array.from({ length: MAX_COMMITS + 5 }, (_, i) => ({ sha: `sha${i}` }));
    await enrichDeployment(db, only(db), NOW, { fetch: github(many) });
    expect(listDeploymentCommits(db, only(db).id)).toHaveLength(MAX_COMMITS);
  });

  it('bounds how many deployments one cycle enriches', async () => {
    expect(ENRICH_PER_CYCLE).toBeGreaterThan(0);
    expect(ENRICH_PER_CYCLE).toBeLessThanOrEqual(10);

    const db = createTestDb();
    const sent = vi.fn();
    // With no connection the cycle asks once rather than per deployment.
    await expect(enrichRecent(db, env, NOW, { fetch: sent as unknown as typeof fetch })).resolves.toEqual({ enriched: 0, commits: 0 });
    expect(sent).not.toHaveBeenCalled();
  });
});

describe('what the detail says', () => {
  it('THE RULING: a deployment nobody enriched reports no change counts, rather than zeroes', async () => {
    const db = createTestDb();
    recordDeployments(db, env, [seen()], NOW);
    const detail = getDeployment(db, { ...env, id: 'ecs-svc/1' }, context);
    // Zero files changed and "we never looked" are different facts, and only one means nothing shipped.
    expect(detail?.changes).toBeUndefined();
    expect(detail?.evidence).toEqual([]);
  });

  it('carries the commits, the files and a link built by the server', async () => {
    const db = createTestDb();
    await connected(db);
    mapped(db);
    recordDeployments(db, env, [seen()], NOW);
    await enrichDeployment(db, only(db), NOW, { fetch: github([{ sha: 'abc1234', files: 3 }]) });

    const detail = getDeployment(db, { ...env, id: 'ecs-svc/1' }, context);
    expect(detail?.changes).toEqual({ files: 3, additions: 9, deletions: 3 });
    expect(detail?.commit).toMatchObject({ sha: 'abc1234', author: 'Ada', url: 'https://github.com/acme/web/commit/abc1234' });
    expect(detail?.repository).toBe('acme/web');
    expect(detail?.evidence[0]).toMatchObject({ repository: 'acme/web', file: 'src/pay-0.ts' });
    expect(detail?.evidence[0].summary).toContain('3 files, +9 −3');
  });

  it('THE RULING: the problems beside it are a correlation with a stated gap, and nothing else', async () => {
    const db = createTestDb();
    await connected(db);
    mapped(db);
    recordDeployments(db, env, [seen()], NOW);
    await enrichDeployment(db, only(db), NOW, { fetch: github([{ sha: 'abc1234' }]) });
    insertProblem(db, newProblem({ key: 'after'.padEnd(32, 'x'), firstSeenAt: NOW - 8 * MINUTE, lastSeenAt: NOW, lastEvaluatedAt: NOW }));

    const detail = getDeployment(db, { ...env, id: 'ecs-svc/1' }, context);
    // The only field relating the two is named for the observation. Nothing says caused.
    expect(Object.keys(detail?.relatedProblems[0] ?? {}).sort()).toEqual(['minutesAfterDeployment', 'problem']);
    expect(detail?.relatedProblems[0].minutesAfterDeployment).toBe(12);
    expect(JSON.stringify(detail)).not.toMatch(/caused|because/i);
  });

  it('records a commit whose detail could not be read, with an absent file list rather than an empty claim', async () => {
    const db = createTestDb();
    await connected(db);
    mapped(db);
    recordDeployments(db, env, [seen()], NOW);

    const partial = (async (url: string) => {
      if (url.endsWith('/user')) return new Response(JSON.stringify({ login: 'acme' }), { status: 200 });
      if (url.includes('/commits?')) return new Response(JSON.stringify([{ sha: 'abc', commit: { message: 'Change', author: { name: 'Ada', date: new Date(NOW).toISOString() } } }]), { status: 200 });
      return new Response('{}', { status: 500 });
    }) as unknown as typeof fetch;

    await enrichDeployment(db, only(db), NOW, { fetch: partial });
    // Knowing it shipped is worth more than knowing which files it touched.
    expect(listDeploymentCommits(db, only(db).id)).toMatchObject([{ sha: 'abc', files: [] }]);
  });
});
