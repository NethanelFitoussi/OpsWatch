import { isOpsWatchFilter } from './filter-name';

/**
 * Deciding whether OpsWatch may put a subscription filter on a log group.
 *
 * CloudWatch Logs allows a small number of filters per log group, and the number is AWS's to change. So
 * this does not count: it looks at **whose** filters are already there and refuses to touch one that is
 * not OpsWatch's. Whether a second slot is free is a question AWS answers, by accepting the call or by
 * refusing it — and a refusal is reported as the conflict it is rather than predicted from a constant
 * that may be wrong by the time somebody reads this.
 *
 * Pure: a list in, a decision out.
 */

export type ExistingFilter = { filterName: string; destinationArn: string | null };

export type SubscriptionDecision =
  /** Nothing is there. */
  | { kind: 'create' }
  /** OpsWatch's own filter is already there, pointing at the same forwarder. Nothing to do. */
  | { kind: 'already' }
  /** OpsWatch's own filter is there but points somewhere else — a re-installed stack, a new forwarder. */
  | { kind: 'update' }
  /** Somebody else's. Named, because "it did not work" is not an answer an operator can act on. */
  | { kind: 'conflict'; owner: string };

export function decideSubscription(existing: readonly ExistingFilter[], ours: string, destinationArn: string): SubscriptionDecision {
  const foreign = existing.find((filter) => !isOpsWatchFilter(filter.filterName));
  // Refused before anything else: a log group carrying another vendor's forwarder is one OpsWatch leaves
  // exactly as it found it, whatever room AWS might or might not have beside it.
  if (foreign !== undefined) return { kind: 'conflict', owner: foreign.filterName };

  const mine = existing.find((filter) => filter.filterName === ours);
  if (mine === undefined) return existing.length === 0 ? { kind: 'create' } : { kind: 'update' };
  return mine.destinationArn === destinationArn ? { kind: 'already' } : { kind: 'update' };
}

/**
 * Why an attempt failed, as a code rather than as AWS's sentence.
 *
 * `limit` is the one worth telling apart: it means the log group is full, which an operator fixes by
 * removing something rather than by trying again.
 */
export type SubscriptionFailure = 'conflict' | 'limit' | 'denied' | 'not_found' | 'failed';

export function failureOf(awsErrorName: string | undefined): SubscriptionFailure {
  if (awsErrorName === 'LimitExceededException') return 'limit';
  if (awsErrorName === 'AccessDeniedException') return 'denied';
  if (awsErrorName === 'ResourceNotFoundException') return 'not_found';
  return 'failed';
}
