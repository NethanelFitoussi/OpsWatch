export const CONNECTION_METHODS = ['role', 'ambient', 'keys'] as const;
export type ConnectionMethod = (typeof CONNECTION_METHODS)[number];

export const CONNECTION_STATUSES = ['draft', 'pending', 'ok', 'degraded', 'failed'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export type { CheckStatus, PermissionTestResult, ServiceCheck } from '../aws/permission-types';
