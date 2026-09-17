export type CheckedService = 'ecs' | 'elb' | 'rds' | 'pi' | 'cloudwatch' | 'logs';

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
  /** An AWS error name, or one of OPSWATCH_IDENTITY_ERRORS (see identity-errors.ts). */
  identityError?: string;
  checks: ServiceCheck[];
  testedAt: string;
};
