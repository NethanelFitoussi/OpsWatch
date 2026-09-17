export const CONNECTION_METHODS = ['role', 'ambient', 'keys'] as const;
export type ConnectionMethod = (typeof CONNECTION_METHODS)[number];

export const CONNECTION_STATUSES = ['draft', 'pending', 'ok', 'degraded', 'failed'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const CHECKED_SERVICES = ['ecs', 'elb', 'rds', 'pi', 'cloudwatch', 'logs'] as const;
export type CheckedService = (typeof CHECKED_SERVICES)[number];

export type CheckStatus = 'ok' | 'denied' | 'error' | 'not_applicable';

export type ServiceCheck = {
  service: CheckedService;
  region: string;
  action: string;
  status: CheckStatus;
  errorCode?: string;
  checkedAt: string;
};

export type OverallStatus = 'ok' | 'degraded' | 'failed';

export type PermissionTestResult = {
  overall: OverallStatus;
  accountMatches: boolean;
  identityArn?: string;
  identityError?: string;
  checks: ServiceCheck[];
  testedAt: string;
};
