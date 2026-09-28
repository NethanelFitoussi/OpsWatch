import { describe, expect, it } from 'vitest';
import { createDoConnection, createGoogleConnection } from '@/lib/connections/repository';
import { doTargetFrom } from '@/lib/do/target';
import { gcpTargetFrom } from '@/lib/gcp/target';
import { MONITORING_PROVIDERS, monitoringProvider } from '@/lib/monitoring/provider-registry';
import { PROVIDERS } from '@/lib/connections/types';
import { createTestDb } from '../helpers/db';

/**
 * What a read needs before it can be made, per cloud.
 *
 * The detect cycle used to resolve **AWS's** target — an `sts:AssumeRole` call — for every connection
 * whatever cloud it was to. That was harmless only while AWS was the one provider with families to
 * read: the first Google family would have made every Google cycle throw `connection_unavailable`,
 * reporting a perfectly good project as unreachable before a single Google request was attempted.
 *
 * The second thing here is smaller and older. Five of the columns a Google read needs are nullable,
 * because a connection exists before it is configured, and every caller turned that into `?? ''` at
 * the call site — which sends `projects//locations/global/...` to Google and shows the rejection as
 * though Google had refused an access grant. "Not finished" and "refused" are different sentences.
 */

const SECRET = 'instance-secret'.padEnd(32, 'x');
const BASE = 'https://opswatch.example';
const NOW = new Date('2026-09-28T09:00:00Z');

const google = (over: Record<string, string | string[]> = {}) => ({
  name: 'analytics',
  projectId: 'my-project-123',
  projectNumber: '123456789012',
  poolId: 'opswatch',
  providerId: 'opswatch',
  serviceAccount: '',
  regions: ['us-central1'],
  ...over,
});

describe('resolving what a provider needs to read', () => {
  it('THE RULING: the detect cycle asks the provider, not AWS', async () => {
    /*
     * A source assertion, because the failure it guards leaves no trace in a unit run: with no Google
     * families yet, the cycle returns before reaching the resolver, so calling the wrong one is
     * invisible until the day it is not. `resolveTarget` is AWS's, and the cycle must not reach for it.
     */
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../src/lib/collector/detect.ts', import.meta.url), 'utf8');
    expect(source).toContain('monitoring.resolveTarget(');
    expect(source).not.toContain("from '../monitoring/target'");
  });

  it('THE RULING: a provider that reads families can resolve a target for its own cloud', () => {
    for (const provider of PROVIDERS) {
      const implementation = monitoringProvider(provider);
      if (implementation.families.length === 0) continue;
      // Families with no way to get a target is a capability that fails on first use.
      expect(implementation.resolveTarget, provider).not.toBeNull();
    }
  });

  it('gives each provider its own resolver rather than one shared shape', () => {
    // Not a style point: AWS's is role credentials for a region, Google's is a signing key and a pool,
    // DigitalOcean's is an account-wide token with no region in it. One `credentials` field the three
    // fill differently is how the AWS model gets cloned under generic names.
    const resolvers = PROVIDERS.map((provider) => MONITORING_PROVIDERS[provider].resolveTarget);
    expect(new Set(resolvers).size).toBe(PROVIDERS.length);
  });

  it('refuses an AWS family a Google target, rather than reading nothing and calling it healthy', async () => {
    const aws = monitoringProvider('aws');
    const result = await aws.loadFamily!('ecs', { provider: 'gcp' } as never, 0);
    expect(result).toMatchObject({ ok: false, code: 'wrong_target_provider' });
  });
});

describe('a Google target', () => {
  it('THE RULING: a half-configured connection is refused, never sent as empty strings', () => {
    const db = createTestDb();
    const row = createGoogleConnection(db, google(), SECRET, NOW);

    // Each of the four in turn: with it missing there is no target, whatever the other three say.
    for (const column of ['gcpProjectId', 'gcpProjectNumber', 'gcpPoolId', 'gcpProviderId'] as const) {
      const result = gcpTargetFrom({ ...row, [column]: null }, 'us-central1', { secret: SECRET, baseUrl: BASE });
      expect(result, column).toMatchObject({ ok: false, code: 'NotReady' });
    }
    // And with all four present it resolves, so the test above is about the column and not the row.
    expect(gcpTargetFrom(row, 'us-central1', { secret: SECRET, baseUrl: BASE }).ok).toBe(true);
  });

  it('refuses a project number that is not one, because the audience is built from it', () => {
    const db = createTestDb();
    const row = createGoogleConnection(db, google(), SECRET, NOW);
    // `//iam.googleapis.com/projects/not-a-number/...` is a string Google will reject, and a rejection
    // that arrives from Google reads as an access problem rather than a typo in a form.
    expect(gcpTargetFrom({ ...row, gcpProjectNumber: 'my-project' }, 'us-central1', { secret: SECRET, baseUrl: BASE })).toMatchObject({
      ok: false,
      code: 'NotReady',
    });
  });

  it('tells an unfinished connection from one whose secret changed', () => {
    const db = createTestDb();
    const row = createGoogleConnection(db, google(), SECRET, NOW);

    // Two different problems with two different fixes: finish the setup, or restore OPSWATCH_SECRET.
    expect(gcpTargetFrom({ ...row, gcpKeyCiphertext: null }, 'us-central1', { secret: SECRET, baseUrl: BASE })).toMatchObject({
      ok: false,
      code: 'NotReady',
    });
    expect(gcpTargetFrom(row, 'us-central1', { secret: 'a-different-secret'.padEnd(32, 'y'), baseUrl: BASE })).toMatchObject({
      ok: false,
      code: 'SecretChanged',
    });
  });

  it('carries the key itself and never the ciphertext', () => {
    const db = createTestDb();
    const row = createGoogleConnection(db, google(), SECRET, NOW);
    const result = gcpTargetFrom(row, 'us-central1', { secret: SECRET, baseUrl: BASE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.key.privateKeyPem).toContain('PRIVATE KEY');
    expect(result.data.region).toBe('us-central1');
    expect(result.data.federation.projectNumber).toBe('123456789012');
  });
});

describe('a DigitalOcean target', () => {
  it('tells "no token yet" from "the token will not decrypt"', () => {
    const db = createTestDb();
    const row = createDoConnection(db, { name: 'do', token: 'dop_v1_'.padEnd(71, 'a') }, SECRET, NOW);

    expect(doTargetFrom(row, SECRET)).toMatchObject({ ok: true });
    expect(doTargetFrom({ ...row, doTokenCiphertext: null }, SECRET)).toMatchObject({ ok: false, code: 'NotReady' });
    expect(doTargetFrom(row, 'a-different-secret'.padEnd(32, 'y'))).toMatchObject({ ok: false, code: 'SecretChanged' });
  });

  it('has no region in it, because DigitalOcean has no per-region endpoint to send one to', () => {
    const db = createTestDb();
    const row = createDoConnection(db, { name: 'do', token: 'dop_v1_'.padEnd(71, 'a') }, SECRET, NOW);
    const result = doTargetFrom(row, SECRET);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Inventing one would be parity DigitalOcean does not offer; the region is on each droplet instead.
    expect(Object.keys(result.data).sort()).toEqual(['connectionId', 'provider', 'token']);
  });

  it('refuses a connection to another cloud outright', () => {
    const db = createTestDb();
    const row = createGoogleConnection(db, google(), SECRET, NOW);
    expect(doTargetFrom(row, SECRET)).toMatchObject({ ok: false, code: 'ConnectionNotFound' });
  });
});
