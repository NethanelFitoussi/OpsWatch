/**
 * Which cloud a connection is to.
 *
 * `aws` is the default and what every existing connection is. A provider is **provenance** — where a
 * resource was discovered — and not a separate product: an operator investigates a machine or a
 * database, and which cloud it came from is a fact about it rather than a different place to look.
 */
export const PROVIDERS = ['aws', 'gcp', 'do'] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * How OpsWatch authenticates to a cloud.
 *
 * The first three are AWS's. `federation` is Google's, and it is the only Google method offered:
 * Google's own guidance is to "avoid using service account keys whenever possible", and names
 * non-repudiation as the reason — "there is no reliable way to tell who used the key". A self-hosted
 * instance can use the recommended path even when nobody can reach it from the internet, because the
 * provider takes the JWK set by upload rather than fetching it from the issuer.
 */
export const CONNECTION_METHODS = ['role', 'ambient', 'keys', 'federation', 'token'] as const;
export type ConnectionMethod = (typeof CONNECTION_METHODS)[number];

/** Which methods belong to which cloud. A method from the wrong one is not a choice, it is a mistake. */
export const METHODS_BY_PROVIDER: Record<Provider, readonly ConnectionMethod[]> = {
  aws: ['role', 'ambient', 'keys'],
  gcp: ['federation'],
  // DigitalOcean has no federation to offer, so a token is the only honest option — and its custom
  // scopes make it a narrow one: `droplet:read` and nothing else.
  do: ['token'],
};

export const CONNECTION_STATUSES = ['draft', 'pending', 'ok', 'degraded', 'failed'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/**
 * A connection known to be an AWS one, with the account id that every AWS path needs.
 *
 * `aws_account_id` is nullable because a Google Cloud connection has none, and a sentinel in a NOT NULL
 * column would be a lie that every reader would then have to know about. This is the narrowing that
 * keeps the AWS paths honest instead: they take a row that has been checked, rather than a row they
 * assume about.
 */
export type AwsConnectionFields = { provider: Provider; awsAccountId: string | null };

export function awsAccountOf<T extends AwsConnectionFields>(row: T): (T & { awsAccountId: string }) | null {
  return row.provider === 'aws' && row.awsAccountId !== null ? (row as T & { awsAccountId: string }) : null;
}

/** Statuses whose connection can be monitored: its last permission test passed at least partly. */
const USABLE_STATUSES = ['ok', 'degraded'] as const satisfies readonly ConnectionStatus[];

export function isUsableStatus(status: string): boolean {
  return (USABLE_STATUSES as readonly string[]).includes(status);
}

export type { CheckStatus, PermissionTestResult, ServiceCheck } from '../aws/permission-types';
