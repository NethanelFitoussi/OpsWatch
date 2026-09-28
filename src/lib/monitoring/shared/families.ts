import type { Provider } from '../../connections/types';

/**
 * Which families each provider's health is computed over.
 *
 * **One list, because it was four.** The same four names were declared separately in
 * `monitoring/overview` (what the Insights page loads), `read/health` (what the Health page shows),
 * `detect/family` (what a problem belongs to) and, through that last one, in the report. They were
 * four copies rather than one import for a real reason — the read layer must not import the collector,
 * and `detect/family` must not import the AWS stack — but the consequence was that adding a fifth
 * family in the obvious place would have added it to the cycle and left it out of Health and the
 * report, showing as neither healthy nor unknown but simply absent.
 *
 * This is the leaf they can all reach: no imports but a type, nothing server-only in it, so the read
 * layer, the detect layer and the provider registry can each take the list from the same place.
 *
 * It is keyed by provider because a family list is a provider's, not the product's. AWS has four;
 * the others have none yet, which is the same statement `capabilities.ts` makes as `health: not_built`
 * and the registry makes as an empty `families` — and is checked against both.
 */
export const PROVIDER_FAMILIES = {
  /** In the order the product shows them, which is the order every page iterates. */
  aws: ['ecs', 'rds', 'alb', 'alarms'],
  /*
   * One, and it is Google's own verdicts rather than OpsWatch's.
   *
   * Not four families mirroring AWS's with Google service names in them. OpsWatch does not evaluate
   * Google's metrics and decide something is wrong: the project's alerting policies do that, an
   * operator wrote them, and relaying what they opened is using the provider's evidence. A parallel
   * set of OpsWatch thresholds would be a second opinion beside the one the project already has, and
   * the two would disagree in front of somebody at three in the morning.
   */
  gcp: ['gcp_alerts'],
  do: [],
} as const satisfies Record<Provider, readonly string[]>;

export const AWS_FAMILIES = PROVIDER_FAMILIES.aws;
export type AwsFamily = (typeof AWS_FAMILIES)[number];

export const GCP_FAMILIES = PROVIDER_FAMILIES.gcp;
export type GcpFamily = (typeof GCP_FAMILIES)[number];

/** Any family, whichever cloud it belongs to. What `family_snapshots.family` holds. */
export type MonitoringFamily = AwsFamily | GcpFamily;

/** What to iterate for a connection to this cloud. Empty is an answer: nothing is read there yet. */
export const familiesOf = (provider: Provider): readonly MonitoringFamily[] => PROVIDER_FAMILIES[provider];
