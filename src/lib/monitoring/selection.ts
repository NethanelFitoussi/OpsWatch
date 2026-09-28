import 'server-only';
import { parseEnvironmentId } from '@opswatch/contract';
import { isUsableStatus } from '../connections/types';
import { supports } from './capabilities';
import type { ConnectionRow } from '../db/schema';
import type { MonitoringScope } from './call';

export type SelectionCheck = { kind: 'ok'; row: ConnectionRow } | { kind: 'not_found' } | { kind: 'unusable'; connectionId: string };

/**
 * Whether this connection has monitoring sections at all.
 *
 * Asked of the capability table rather than of the provider's name. `provider === 'aws'` was true and
 * said nothing: it could not be read as a statement about the product, and it had to be found and
 * changed by hand every time a provider gained something. A connection has sections when OpsWatch can
 * give it a verdict about its estate — which is what `health` means — and the table is checked against
 * the implementations that would have to serve it.
 *
 * A section that does not exist for a provider is a 404, not an apology. What each of those providers
 * *can* show lives on its own connection page, and the rail does not offer these to it.
 */
const hasMonitoringSections = (row: ConnectionRow): boolean => supports(row.provider, 'health');

/** The region is checked first: a region the connection does not use is a 404 whatever the status. */
export function checkSelection(row: ConnectionRow | null, region: string): SelectionCheck {
  if (!row || !hasMonitoringSections(row) || !row.regions.includes(region)) return { kind: 'not_found' };
  if (!isUsableStatus(row.status)) return { kind: 'unusable', connectionId: row.id };
  return { kind: 'ok', row };
}

export function firstUsableSelection(rows: readonly ConnectionRow[]): MonitoringScope | null {
  const row = rows.find((r) => hasMonitoringSections(r) && isUsableStatus(r.status));
  return row ? { connectionId: row.id, region: row.regions[0] } : null;
}

/**
 * Where a section link goes when the page it was clicked from named no environment.
 *
 * The operator's own choice first. With one AWS account "the first usable connection" was the same
 * thing; with several it meant that somebody working in Client B who visited Settings and clicked
 * *Containers* silently landed in Production — the wrong account, with no sign that they had moved.
 *
 * The preference is checked against what this installation actually has, so a connection that was
 * deleted, or a region it no longer watches, falls back rather than 404s.
 */
export function preferredSelection(rows: readonly ConnectionRow[], defaultEnvironmentId: string | null): MonitoringScope | null {
  const wanted = defaultEnvironmentId === null ? null : parseEnvironmentId(defaultEnvironmentId);
  if (wanted !== null) {
    const row = rows.find((r) => r.id === wanted.connectionId);
    if (row !== undefined && hasMonitoringSections(row) && isUsableStatus(row.status) && row.regions.includes(wanted.scope)) {
      return { connectionId: row.id, region: wanted.scope };
    }
  }
  return firstUsableSelection(rows);
}
