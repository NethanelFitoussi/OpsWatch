import 'server-only';
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
