import { describe, expect, it } from 'vitest';
import { ConnectionInputError, createConnection, createGoogleConnection, listConnections, toView } from '@/lib/connections/repository';
import { awsAccountOf } from '@/lib/connections/types';
import { openConnectionKey } from '@/lib/gcp/issuer';
import { createTestDb } from '../helpers/db';
import { connectionInput } from '../helpers/fixtures';

/**
 * A connection to a second cloud.
 *
 * The thing worth breaking here is the one that used to be impossible to get wrong: every connection
 * was an AWS account, and `aws_account_id` was NOT NULL because there was nothing else it could be.
 * Now there is, and the risk is a Google row wandering into an AWS path — where it would be read as an
 * account with no number rather than as the different thing it is.
 */

const NOW = new Date('2026-09-25T12:00:00Z');
const SECRET = 'instance-secret'.padEnd(32, 'x');

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

describe('connecting a Google Cloud project', () => {
  it('THE RULING: it stores no Google credential, only where to send a token it signs itself', () => {
    const db = createTestDb();
    const row = createGoogleConnection(db, google(), SECRET, NOW);

    expect(row).toMatchObject({
      provider: 'gcp',
      method: 'federation',
      gcpProjectId: 'my-project-123',
      gcpProjectNumber: '123456789012',
      // No AWS account, rather than an empty one: they are different facts.
      awsAccountId: null,
      // Nothing has been proved yet. The operator still has to create the pool and grant the roles.
      status: 'draft',
    });
    // Everything stored about Google is public. The only secret is the half of OpsWatch's own key.
    const withoutKey = { ...row, gcpKeyCiphertext: null };
    expect(JSON.stringify(withoutKey)).not.toMatch(/PRIVATE KEY|BEGIN /);
    expect(row.gcpKeyCiphertext).not.toBeNull();
    expect(openConnectionKey(row.gcpKeyCiphertext as string, SECRET)?.privateKeyPem).toContain('PRIVATE KEY');
  });

  it('gives every connection its own key, so withdrawing one stops exactly one', () => {
    const db = createTestDb();
    const first = createGoogleConnection(db, google({ name: 'one' }), SECRET, NOW);
    const second = createGoogleConnection(db, google({ name: 'two' }), SECRET, NOW);

    const keyOf = (row: typeof first) => openConnectionKey(row.gcpKeyCiphertext as string, SECRET);
    expect(keyOf(first)?.kid).not.toBe(keyOf(second)?.kid);
  });

  it('refuses a name that is not a Google name, before it is stored anywhere', () => {
    const db = createTestDb();
    for (const [field, value, code] of [
      ['projectId', 'Not A Project', 'gcp_project_invalid'],
      ['projectNumber', '12ab', 'gcp_project_number_invalid'],
      ['poolId', '../evil', 'gcp_pool_invalid'],
      ['providerId', 'UPPER', 'gcp_provider_invalid'],
      ['serviceAccount', 'ops@evil.example', 'gcp_service_account_invalid'],
    ] as const) {
      expect(() => createGoogleConnection(db, google({ [field]: value }), SECRET, NOW), field).toThrow(ConnectionInputError);
      try {
        createGoogleConnection(db, google({ [field]: value }), SECRET, NOW);
      } catch (error) {
        expect((error as ConnectionInputError).code, field).toBe(code);
      }
    }
    expect(listConnections(db)).toEqual([]);
  });

  it('needs at least one region, because every monitoring page in this product is about one', () => {
    const db = createTestDb();
    expect(() => createGoogleConnection(db, google({ regions: [] }), SECRET, NOW)).toThrow(ConnectionInputError);
    expect(() => createGoogleConnection(db, google({ regions: ['Not A Region'] }), SECRET, NOW)).toThrow(ConnectionInputError);
    expect(createGoogleConnection(db, google({ regions: ['us-central1', 'europe-west1'] }), SECRET, NOW).regions).toEqual([
      'us-central1',
      'europe-west1',
    ]);
  });

  it('takes no service account, because federating straight to a resource is equally valid', () => {
    const db = createTestDb();
    expect(createGoogleConnection(db, google({ serviceAccount: '   ' }), SECRET, NOW).gcpServiceAccount).toBeNull();
    expect(
      createGoogleConnection(db, google({ serviceAccount: 'opswatch@my-project.iam.gserviceaccount.com' }), SECRET, NOW).gcpServiceAccount,
    ).toBe('opswatch@my-project.iam.gserviceaccount.com');
  });
});

describe('a Google connection in an AWS path', () => {
  it('THE RULING: it is never read as an AWS account with no number', () => {
    const db = createTestDb();
    const aws = createConnection(db, connectionInput(), NOW);
    const gcp = createGoogleConnection(db, google(), SECRET, NOW);

    // The narrowing every AWS path goes through: it answers for one and refuses the other.
    expect(awsAccountOf(aws)?.awsAccountId).toBe(aws.awsAccountId);
    expect(awsAccountOf(gcp)).toBeNull();

    // And the provider is what decides, not whether a number happens to be there. A row carrying both
    // is not an AWS connection with an extra field; it is a Google one, and reading it as AWS would
    // send its project into calls meant for an account.
    expect(awsAccountOf({ provider: 'gcp', awsAccountId: '111122223333' })).toBeNull();
    expect(awsAccountOf({ provider: 'aws', awsAccountId: '111122223333' })?.awsAccountId).toBe('111122223333');
  });

  it('carries the provider and the project into the view the pages read', () => {
    const db = createTestDb();
    const row = createGoogleConnection(db, google(), SECRET, NOW);
    const view = toView(row, SECRET);

    expect(view).toMatchObject({ provider: 'gcp', gcpProjectId: 'my-project-123', awsAccountId: null });
    // And the view never carries key material, whatever the connection is.
    expect(JSON.stringify(view)).not.toContain('PRIVATE KEY');
  });

  it('calls an existing AWS connection an AWS one without anybody having said so', () => {
    const db = createTestDb();
    expect(createConnection(db, connectionInput(), NOW).provider).toBe('aws');
  });
});
