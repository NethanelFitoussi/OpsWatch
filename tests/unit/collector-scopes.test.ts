import { describe, expect, it } from 'vitest';
import { DO_ACCOUNT_SCOPE, SCOPE_KINDS, scopeKindOf, scopesOf } from '@/lib/monitoring/shared/scopes';
import { dueJobs } from '@/lib/collector/runner';
import { JOBS } from '@/lib/collector/jobs';
import { PROVIDERS } from '@/lib/connections/types';

/**
 * What a scope is, and which jobs belong to which cloud.
 *
 * `scope` has meant "AWS region" since there was only AWS, and it is really the unit the provider's
 * data is scoped to. Google's alerting policies and incidents belong to a **project**, which spans
 * regions: collecting a two-region project once per region would open the same Google incident twice,
 * as two OpsWatch problems under two scopes, and resolve neither when Google closed it.
 *
 * The second half is the same mistake one layer up. Every environment-scoped job reads CloudWatch, and
 * every one of them ran for every connection whatever cloud it was to.
 */

const connection = (over: Partial<Parameters<typeof scopesOf>[0]> = {}) => ({
  provider: 'aws' as const,
  regions: ['eu-west-1'],
  gcpProjectId: null,
  ...over,
});

describe('what a scope is, per cloud', () => {
  it('THE RULING: a Google project is one scope however many regions were chosen', () => {
    /*
     * Two regions would mean two detect cycles reading the same project-wide alerts, opening the same
     * incident as two problems. Nothing downstream would notice: both are valid rows.
     */
    const scopes = scopesOf(connection({ provider: 'gcp', regions: ['us-central1', 'europe-west1'], gcpProjectId: 'my-project' }));
    expect(scopes).toEqual(['my-project']);
  });

  it('leaves AWS exactly as it was, because for AWS a region is the right unit', () => {
    // Two regions of one account are two estates with two of everything, and always were.
    expect(scopesOf(connection({ regions: ['eu-west-1', 'us-east-1'] }))).toEqual(['eu-west-1', 'us-east-1']);
  });

  it('gives DigitalOcean one scope for the account, and never its token', () => {
    // Its API answers for the whole account at once; each droplet carries its own region.
    const scopes = scopesOf(connection({ provider: 'do', regions: [] }));
    expect(scopes).toEqual([DO_ACCOUNT_SCOPE]);
    // A database key made from a credential would put a secret in every row and in the audit log.
    expect(DO_ACCOUNT_SCOPE).toBe('account');
  });

  it('collects nothing rather than collecting under an empty string', () => {
    // A half-configured Google connection has no project yet. Rows written under '' could never be
    // found again, and would look like a collected environment on System status.
    expect(scopesOf(connection({ provider: 'gcp', regions: ['us-central1'], gcpProjectId: null }))).toEqual([]);
    expect(scopesOf(connection({ provider: 'gcp', regions: ['us-central1'], gcpProjectId: '' }))).toEqual([]);
  });

  it('names what one scope is, for a page that has to say it', () => {
    for (const provider of PROVIDERS) expect(SCOPE_KINDS[provider], provider).toBeTypeOf('string');
    expect(scopeKindOf('gcp')).toBe('project');
    expect(scopeKindOf('aws')).toBe('region');
  });
});

describe('which jobs belong to which cloud', () => {
  const environments = [
    { connectionId: 'a', scope: 'eu-west-1', provider: 'aws' as const },
    { connectionId: 'g', scope: 'my-project', provider: 'gcp' as const },
    { connectionId: 'd', scope: 'account', provider: 'do' as const },
  ];
  const due = (enabled: Parameters<typeof dueJobs>[0]['enabled']) =>
    dueJobs({ nowMs: 1_000_000, environments, lastRunAt: new Map(), enabled });

  it('THE RULING: a job that reads CloudWatch does not run in a Google project', () => {
    /*
     * With history switched on, `metrics` asked a Google project for CloudWatch every five minutes
     * and threw `connection_unavailable` every time — a permanent red mark on System status for a
     * connection working exactly as designed.
     */
    const jobs = due(['metrics']);
    expect(jobs.map((job) => job.connectionId)).toEqual(['a']);
  });

  it('runs detect for every cloud, because detect asks the registry', () => {
    // The one environment-scoped job with no provider list: it reads whatever families that provider
    // has, and answers honestly for a cloud with none.
    expect(JOBS.detect.providers).toBeUndefined();
    expect(due(['detect']).map((job) => job.connectionId).sort()).toEqual(['a', 'd', 'g']);
  });

  it('holds every AWS reader to AWS, so a new one cannot quietly run everywhere', () => {
    for (const id of ['metrics', 'errors', 'synthetics', 'deployments', 'baselines'] as const) {
      expect(JOBS[id].providers, id).toEqual(['aws']);
    }
  });

  it('leaves instance-scoped jobs alone: they have no connection to have a provider', () => {
    expect(due(['notify'])).toEqual([{ id: 'notify', connectionId: null, scope: null }]);
  });
});
