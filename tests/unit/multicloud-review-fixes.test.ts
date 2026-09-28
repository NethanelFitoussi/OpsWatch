import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const SECRET = 'instance-secret'.padEnd(32, 'x');
// `alertUrl` reads the instance's public URL to build an absolute link, so the whole file gets a
// settled configuration rather than whatever the runner happens to have in its environment.
vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: SECRET, OPSWATCH_PUBLIC_URL: 'https://opswatch.example' }) }));
import { createDoConnection, createGoogleConnection, createConnection } from '@/lib/connections/repository';
import { alertUrl } from '@/lib/notify/deliver';
import { scopesOf } from '@/lib/monitoring/shared/scopes';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { readSystemStatus } from '@/lib/read/system';
import { finishRun, startRun } from '@/lib/store/collector';
import { createTestDb } from '../helpers/db';
import { connectionInput } from '../helpers/fixtures';

/**
 * Six defects a second pair of eyes found in the multi-cloud work, held so they cannot come back.
 *
 * Three of them are mine from this week, and they share a shape: a thing that was written once when
 * AWS was the only cloud, and that stayed correct right up until it silently wasn't. None of them
 * threw, none failed a test, and every one of them would have shown an operator something untrue.
 */

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
const google = {
  name: 'analytics',
  projectId: 'my-project',
  projectNumber: '123456789012',
  poolId: 'opswatch',
  providerId: 'opswatch',
  serviceAccount: '',
  regions: ['us-central1', 'europe-west1'],
};

describe('a partial read is not a complete one', () => {
  it('THE RULING: a family that stopped early cannot let a problem resolve itself', () => {
    /*
     * The cycle clears a live problem when its family was read and the problem did not reappear.
     * Google's incidents are paged and the read stops at a cap, so an incident still open can be
     * missing from what was read — and the family, reported as fully read, would have **resolved a
     * problem Google still reports as open**. Silence only means "gone" when everything was looked at.
     */
    const source = readFileSync(new URL('../../src/lib/collector/detect.ts', import.meta.url), 'utf8');
    const readSet = source.slice(source.indexOf('const read = new Set('), source.indexOf('const insights ='));
    expect(readSet).toContain('result.data.truncated !== true');

    // And a partial read with nothing wrong in what it saw is `unknown`, never `healthy`.
    const snapshot = source.slice(source.indexOf('recordFamilySnapshot(input.db, {'));
    expect(snapshot).toContain("result.data.truncated === true ? 'unknown' : 'healthy'");
  });

  it('is what the Google family reports when it stopped at the cap', async () => {
    const { gcpAlertsFamily } = await import('@/lib/gcp/family');
    const source = readFileSync(new URL('../../src/lib/gcp/family.ts', import.meta.url), 'utf8');
    expect(source).toContain('truncated: answer.truncated');
    expect(gcpAlertsFamily).toBeTypeOf('function');
  });
});

describe('the score’s persistence term', () => {
  it('THE RULING: it is looked up by what identifies the subject, not by what is shown', () => {
    /*
     * The caller finds the live problem by `subjectId`; the call passed `resource`. For every AWS rule
     * those are the same string, so nothing failed — and for Google they are different, so the lookup
     * never matched and every Google problem scored as though it had just started, however long Google
     * had had the incident open. The one identifier in that hunk I did not update when I split them.
     */
    const source = readFileSync(new URL('../../src/lib/detect/aws.ts', import.meta.url), 'utf8');
    expect(source).toContain('input.breachingMinutes?.(kind, row.subjectId)');
    expect(source).not.toContain('input.breachingMinutes?.(kind, row.resource)');
  });
});

describe('where a notification points', () => {
  it('THE RULING: it never sends a non-AWS alert into the AWS monitoring rail', () => {
    /*
     * `/c/{connection}/{scope}/…` resolves for an AWS connection and for nothing else, so a
     * notification about a Google incident built that way lands on a 404 — at the one moment an
     * operator is following a link because something is actually wrong.
     */
    const gcp = alertUrl({ connectionId: 'c1', scope: 'my-project', problemId: 'p1', provider: 'gcp', problemHref: '/accounts/c1/alerts' });
    expect(gcp).toBe('https://opswatch.example/accounts/c1/alerts');

    // A rail path offered for a non-AWS problem is refused rather than passed through.
    const smuggled = alertUrl({ connectionId: 'c1', scope: 'p', problemId: 'p1', provider: 'gcp', problemHref: '/c/c1/p/overview/problems/p1' });
    expect(smuggled).toBe('https://opswatch.example/accounts/c1');
    // With no link of its own, the connection page, which always exists.
    expect(alertUrl({ connectionId: 'c1', scope: 'p', problemId: 'p1', provider: 'gcp' })).toBe('https://opswatch.example/accounts/c1');

    // AWS keeps exactly the link it always had: this is about the cloud, not about links in general.
    expect(alertUrl({ connectionId: 'c1', scope: 'us-east-1', problemId: 'p1' })).toBe(
      'https://opswatch.example/c/c1/us-east-1/overview/problems/p1',
    );
    // And a machine is still a machine, whatever cloud the environment is.
    expect(alertUrl({ connectionId: 'c1', scope: 'p', problemId: null, hostId: 'h1', provider: 'gcp' })).toBe('https://opswatch.example/hosts/h1');
  });
});

describe('who reconstructs the list of environments', () => {
  it('THE RULING: every one of them asks scopesOf, not the AWS region list', () => {
    /*
     * Four places independently rebuilt "what environments exist" from `connection.regions`. For
     * DigitalOcean that list is empty, so its real `account` scope — which the collector does write
     * under — was invisible on System status. For Google it holds real region strings, so the page
     * invented an environment nothing was ever collected under: permanently "never read", with the
     * working one nowhere to be seen. System status exists to say when OpsWatch cannot see something.
     */
    for (const path of [
      '../../src/app/[locale]/(app)/settings/status/page.tsx',
      '../../src/app/api/v1/system/status/route.ts',
      '../../src/lib/collector/digest-job.ts',
      '../../src/lib/api/v1/environment.ts',
    ]) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(source, path).toContain('scopesOf(connection)');
      expect(source, path).not.toMatch(/connection\.regions\.map|connection\.regions\.includes/);
    }
  });

  it('resolves the scope a non-AWS connection is actually collected under', () => {
    const db = createTestDb();
    const gcp = createGoogleConnection(db, google, SECRET, new Date(NOW));
    const doRow = createDoConnection(db, { name: 'do', token: 'dop_v1_'.padEnd(71, 'a') }, SECRET, new Date(NOW));

    const resolve = (id: string, scope: string) => resolveEnvironment(db, new URL(`https://x/api?env=${id}:${scope}`));
    expect(resolve(gcp.id, 'my-project')).toMatchObject({ ok: true, provider: 'gcp' });
    // A region *is* in `regions`, and is not a scope: rows were never written under it.
    expect(resolve(gcp.id, 'us-central1')).toMatchObject({ ok: false, error: 'not_found' });
    expect(resolve(doRow.id, 'account')).toMatchObject({ ok: true, provider: 'do' });
    // And the scopes it accepts are exactly the ones the collector writes.
    expect(scopesOf(gcp)).toEqual(['my-project']);
  });
});

describe('System status and a job that stopped running somewhere', () => {
  it('THE RULING: a run for an environment the job no longer serves is not its status', () => {
    /*
     * `collector_runs` is a log. An installation that upgraded through the change making `metrics`
     * AWS-only keeps its old failed Google run, and the worst-of picked it for ever — `metrics`
     * reported as failing when it is now correctly not run there at all. A status a job cannot
     * recover from is worse than no status.
     */
    const db = createTestDb();
    const aws = createConnection(db, connectionInput({ name: 'production' }), new Date(NOW));
    const environments = [{ connectionId: aws.id, scope: 'eu-west-1' }];

    const ok = startRun(db, { job: 'metrics', connectionId: aws.id, scope: 'eu-west-1', startedAt: NOW });
    finishRun(db, ok.id, { status: 'ok', finishedAt: NOW + 1_000, covered: 4, total: 4, truncated: false, errorCode: null });
    // The stale one: a Google environment this job is no longer scheduled for.
    const stale = startRun(db, { job: 'metrics', connectionId: 'gone', scope: 'my-project', startedAt: NOW });
    finishRun(db, stale.id, { status: 'failed', finishedAt: NOW + 1_000, covered: 0, total: 0, truncated: false, errorCode: 'connection_unavailable' });

    const status = readSystemStatus(db, { nowMs: NOW + 60_000, environments, dataDir: '/tmp' });
    const metrics = status.jobs.find((job) => job.job === 'metrics');
    expect(metrics?.lastStatus).toBe('ok');
    expect(metrics?.errorCode).toBeNull();
  });
});

describe('a report over a Google environment', () => {
  it('THE RULING: it lists that cloud’s families, not four measured zeroes about services it lacks', async () => {
    /*
     * The families section says a family with nothing in either window is "still listed at zero — that
     * is a measured zero, because `detect` ran over all of them". True of AWS and of nothing else. For
     * a Google project, `detect` ran over `gcp_alerts` and none of AWS's four, so listing those four
     * would be four measured zeroes about services the project does not have — and would leave out the
     * one family that actually was read.
     *
     * Latent until this week: `resolveEnvironment` could not resolve a Google scope, so the endpoint
     * was unreachable. Fixing that made this reachable, which is how one fix uncovers the next.
     */
    const { readReport } = await import('@/lib/read/reports');
    const db = createTestDb();
    const gcp = createGoogleConnection(db, google, SECRET, new Date(NOW));

    const report = readReport(
      db,
      { connectionId: gcp.id, scope: 'my-project', section: 'overview', period: '24h', provider: 'gcp' },
      { nowMs: NOW },
    );
    const families = report.sections.find((section) => section.id === 'families');
    expect(families?.rows.map((row) => row.id)).toEqual(['gcp_alerts']);

    // And AWS still gets exactly the four it always had.
    const aws = createConnection(db, connectionInput({ name: 'production' }), new Date(NOW));
    const awsReport = readReport(db, { connectionId: aws.id, scope: 'eu-west-1', section: 'overview', period: '24h' }, { nowMs: NOW });
    expect(awsReport.sections.find((section) => section.id === 'families')?.rows.map((row) => row.id)).toEqual([
      'ecs',
      'rds',
      'alb',
      'alarms',
    ]);
  });
});

describe('System status, on an installation with more than one cloud', () => {
  it('THE RULING: a job is not behind on work it does not have', () => {
    /*
     * `metrics` is AWS-only now. Counted against every environment, it reported "not yet run in 22
     * environments" on an installation whose twenty-two non-AWS environments it will never run in —
     * which reads as a backlog and is really "does not apply". A monitoring tool reporting itself as
     * behind when it is not is the same class of untruth as reporting an estate healthy when it is.
     */
    const db = createTestDb();
    const aws = createConnection(db, connectionInput({ name: 'production' }), new Date(NOW));
    const gcp = createGoogleConnection(db, google, SECRET, new Date(NOW));
    const environments = [
      { connectionId: aws.id, scope: 'eu-west-1', provider: 'aws' as const, connectionName: aws.name },
      { connectionId: gcp.id, scope: 'my-project', provider: 'gcp' as const, connectionName: gcp.name },
    ];

    const run = startRun(db, { job: 'metrics', connectionId: aws.id, scope: 'eu-west-1', startedAt: NOW });
    finishRun(db, run.id, { status: 'ok', finishedAt: NOW + 1_000, covered: 4, total: 4, truncated: false, errorCode: null });

    const status = readSystemStatus(db, { nowMs: NOW + 60_000, environments, dataDir: '/tmp' });
    const metrics = status.jobs.find((job) => job.job === 'metrics');
    // One AWS environment, one run, nothing outstanding. The Google one is not its business.
    expect(metrics?.environments).toMatchObject({ total: 1, neverRan: 0 });

    // `detect` has no provider list, so it runs in both — and being behind on one, it says so.
    const detectRun = startRun(db, { job: 'detect', connectionId: aws.id, scope: 'eu-west-1', startedAt: NOW });
    finishRun(db, detectRun.id, { status: 'ok', finishedAt: NOW + 1_000, covered: 4, total: 4, truncated: false, errorCode: null });
    const withDetect = readSystemStatus(db, { nowMs: NOW + 60_000, environments, dataDir: '/tmp' });
    expect(withDetect.jobs.find((job) => job.job === 'detect')?.environments).toMatchObject({ total: 2, neverRan: 1 });
  });

  it('THE RULING: every environment row can be told apart from the others', () => {
    /*
     * A scope stopped identifying an environment when scopes became per-provider. Every DigitalOcean
     * account is collected under `account`, so several accounts were several rows reading `account`,
     * `account`, `account` — on the page whose job is telling an operator which of their environments
     * OpsWatch cannot see.
     */
    const db = createTestDb();
    const first = createDoConnection(db, { name: 'europe', token: 'dop_v1_'.padEnd(71, 'a') }, SECRET, new Date(NOW));
    const second = createDoConnection(db, { name: 'staging', token: 'dop_v1_'.padEnd(71, 'b') }, SECRET, new Date(NOW));
    const environments = [first, second].map((row) => ({
      connectionId: row.id,
      scope: 'account',
      provider: 'do' as const,
      connectionName: row.name,
    }));

    const status = readSystemStatus(db, { nowMs: NOW, environments, dataDir: '/tmp' });
    expect(status.environments.map((entry) => entry.connectionName)).toEqual(['europe', 'staging']);
    // And each carries its cloud, so the page can say what kind of thing the scope is.
    expect(status.environments.every((entry) => entry.provider === 'do')).toBe(true);
  });
});
