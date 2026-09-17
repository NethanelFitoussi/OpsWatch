export const CONNECTION_METHODS = ['role', 'ambient', 'keys'] as const;
export type ConnectionMethod = (typeof CONNECTION_METHODS)[number];

export const CONNECTION_STATUSES = ['draft', 'pending', 'ok', 'degraded', 'failed'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/** Statuses whose connection can be monitored: its last permission test passed at least partly. */
export const USABLE_STATUSES = ['ok', 'degraded'] as const satisfies readonly ConnectionStatus[];

export function isUsableStatus(status: string): boolean {
  return (USABLE_STATUSES as readonly string[]).includes(status);
}

export type { CheckStatus, PermissionTestResult, ServiceCheck } from '../aws/permission-types';
