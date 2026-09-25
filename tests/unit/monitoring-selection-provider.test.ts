import { describe, expect, it } from 'vitest';
import { checkSelection, firstUsableSelection, preferredSelection } from '@/lib/monitoring/selection';
import { environmentId } from '@opswatch/contract';
import type { ConnectionRow } from '@/lib/db/schema';

/**
 * A monitoring section belongs to the provider whose service it is about.
 *
 * `/c/{id}/{region}/containers` reads ECS. `databases` reads RDS. `alarms` reads CloudWatch. Every one
 * of the ten is an AWS service — and a Google Cloud or DigitalOcean connection has regions and a
 * usable status like any other, so it passed every check these functions make and the page then asked
 * AWS about an account that does not exist.
 *
 * An operator reads that as "OpsWatch cannot see my project". It is not a credential problem, it is a
 * page that is not about their project, and the difference is the whole of what these hold.
 */

const row = (over: Partial<ConnectionRow> = {}): ConnectionRow =>
  ({
    id: 'c1',
    name: 'prod',
    provider: 'aws',
    method: 'role',
    awsAccountId: '111122223333',
    regions: ['eu-west-1'],
    status: 'ok',
    ...over,
  }) as unknown as ConnectionRow;

const gcp = (over: Partial<ConnectionRow> = {}) => row({ id: 'g1', provider: 'gcp', awsAccountId: null, ...over });
const droplets = (over: Partial<ConnectionRow> = {}) => row({ id: 'd1', provider: 'do', awsAccountId: null, regions: ['eu-west-1'], ...over });

describe('which connections have monitoring sections', () => {
  it('THE RULING: a section that is not about this provider is a 404, not an apology', () => {
    expect(checkSelection(row(), 'eu-west-1')).toMatchObject({ kind: 'ok' });

    // Usable, and with that very region — everything the old check looked at.
    expect(checkSelection(gcp(), 'eu-west-1')).toEqual({ kind: 'not_found' });
    expect(checkSelection(droplets(), 'eu-west-1')).toEqual({ kind: 'not_found' });
  });

  it('THE RULING: a section link from elsewhere never lands on a connection the section is not about', () => {
    /*
     * "Containers" clicked from Settings goes to the operator's default environment, or to the first
     * usable connection. Either could be a Google project, and landing there is landing on an AWS page
     * about an account that is not there.
     */
    expect(firstUsableSelection([gcp(), droplets(), row()])).toEqual({ connectionId: 'c1', region: 'eu-west-1' });
    // Nothing to land on is a different answer from landing somewhere wrong.
    expect(firstUsableSelection([gcp(), droplets()])).toBeNull();
  });

  it('refuses a default environment that names a connection with no sections', () => {
    const preference = environmentId('g1', 'eu-west-1');
    // It falls back to a connection the sections are about, rather than honouring a preference that
    // cannot be served — and rather than 404ing on a page the operator did not ask for.
    expect(preferredSelection([gcp(), row()], preference)).toEqual({ connectionId: 'c1', region: 'eu-west-1' });
    expect(preferredSelection([gcp()], preference)).toBeNull();
  });

  it('still refuses an AWS connection for the reasons it always did', () => {
    // The provider check is added to the others, not instead of them.
    expect(checkSelection(row({ regions: ['us-east-1'] }), 'eu-west-1')).toEqual({ kind: 'not_found' });
    expect(checkSelection(row({ status: 'draft' }), 'eu-west-1')).toEqual({ kind: 'unusable', connectionId: 'c1' });
    expect(checkSelection(null, 'eu-west-1')).toEqual({ kind: 'not_found' });
  });
});
