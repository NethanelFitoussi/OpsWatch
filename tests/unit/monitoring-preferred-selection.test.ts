import { describe, expect, it } from 'vitest';
import { firstUsableSelection, preferredSelection } from '@/lib/monitoring/selection';
import type { ConnectionRow } from '@/lib/db/schema';

/**
 * Which AWS account a section link goes to when the page it was clicked from named none.
 *
 * With one connection "the first usable one" was the same thing as "the operator's". With several it
 * meant that somebody working in Client B who visited Settings and clicked *Containers* silently landed
 * in Production — the wrong account, with nothing on screen to say they had moved.
 */

const connection = (id: string, over: Partial<ConnectionRow> = {}): ConnectionRow =>
  // AWS, because every monitoring section is about an AWS service and these are the connections
  // those links are for. `monitoring-selection-provider.test.ts` holds what happens for the others.
  ({ id, name: id, provider: 'aws', regions: ['us-east-1', 'eu-west-1'], status: 'ok', ...over }) as ConnectionRow;

const rows = [connection('prod'), connection('client-b')];

describe('the environment a section link opens', () => {
  it('THE RULING: the operator’s own choice wins over whichever connection is first', () => {
    expect(preferredSelection(rows, 'client-b:eu-west-1')).toEqual({ connectionId: 'client-b', region: 'eu-west-1' });
    // Without one, the old behaviour stands: the first usable connection and its first region.
    expect(preferredSelection(rows, null)).toEqual(firstUsableSelection(rows));
  });

  it('falls back rather than sending somebody to a connection that is gone', () => {
    // A preference outlives the connection it named: deleting an account must not leave every section
    // link pointing at a 404.
    expect(preferredSelection(rows, 'deleted:us-east-1')).toEqual({ connectionId: 'prod', region: 'us-east-1' });
  });

  it('falls back rather than sending somebody to a region the connection no longer watches', () => {
    expect(preferredSelection(rows, 'client-b:ap-south-1')).toEqual({ connectionId: 'prod', region: 'us-east-1' });
  });

  it('refuses a connection that cannot be monitored, whatever the preference says', () => {
    // A connection whose permission test never passed has nothing to show; landing in it is a dead end.
    const unusable = [connection('prod'), connection('client-b', { status: 'failed' })];
    expect(preferredSelection(unusable, 'client-b:us-east-1')).toEqual({ connectionId: 'prod', region: 'us-east-1' });
  });

  it('says there is nowhere to go when nothing is monitorable', () => {
    expect(preferredSelection([connection('prod', { status: 'failed' })], 'prod:us-east-1')).toBeNull();
    expect(preferredSelection([], null)).toBeNull();
  });

  it('ignores a malformed preference rather than splitting it itself', () => {
    for (const bad of ['', 'no-colon', ':us-east-1', 'prod:', 'prod:a:b']) {
      expect(preferredSelection(rows, bad), bad).toEqual({ connectionId: 'prod', region: 'us-east-1' });
    }
  });
});
