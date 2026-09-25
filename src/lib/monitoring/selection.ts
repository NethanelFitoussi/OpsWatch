import 'server-only';
import { parseEnvironmentId } from '@opswatch/contract';
import { isUsableStatus } from '../connections/types';
import type { ConnectionRow } from '../db/schema';
import type { MonitoringScope } from './call';

export type SelectionCheck = { kind: 'ok'; row: ConnectionRow } | { kind: 'not_found' } | { kind: 'unusable'; connectionId: string };

/** The region is checked first: a region the connection does not use is a 404 whatever the status. */
export function checkSelection(row: ConnectionRow | null, region: string): SelectionCheck {
  if (!row || !row.regions.includes(region)) return { kind: 'not_found' };
  if (!isUsableStatus(row.status)) return { kind: 'unusable', connectionId: row.id };
  return { kind: 'ok', row };
}

export function firstUsableSelection(rows: readonly ConnectionRow[]): MonitoringScope | null {
  const row = rows.find((r) => isUsableStatus(r.status));
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
    if (row !== undefined && isUsableStatus(row.status) && row.regions.includes(wanted.scope)) {
      return { connectionId: row.id, region: wanted.scope };
    }
  }
  return firstUsableSelection(rows);
}
