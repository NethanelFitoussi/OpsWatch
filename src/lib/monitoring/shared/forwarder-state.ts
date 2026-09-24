/**
 * What state a forwarder is in, and the one mistake this must not make.
 *
 * **A forwarder nobody is sending to is not unhealthy.** A quiet log group is the most ordinary thing in
 * the world — out of hours, a staging environment, a service that simply did not log — and calling that
 * `degraded` teaches an operator to ignore the word. `inactive` is the honest answer: installed, working
 * as far as anybody knows, and with nothing to do.
 *
 * Nor is "we have never heard from it" a failure. Until something arrives or something is refused,
 * OpsWatch does not know whether the forwarder works, and `unknown` says exactly that.
 *
 * Pure: facts in, a word out.
 */

export const FORWARDER_STATES = ['not_installed', 'inactive', 'healthy', 'degraded', 'error', 'unknown'] as const;
export type ForwarderState = (typeof FORWARDER_STATES)[number];

export type ForwarderFactsInput = {
  /** Has an operator enabled managed collection at all. */
  managed: boolean;
  /** Has OpsWatch confirmed the function exists in the account. */
  verified: boolean;
  /** How many log groups are actively forwarded. Zero means nothing has been asked to send. */
  activeGroups: number;
  /** Records accepted over the window looked at. */
  events: number;
  /** Requests refused after OpsWatch knew which integration they came from. */
  rejected: number;
  /** Batches the forwarder gave up on, or null when the dead-letter queue could not be read. */
  deadLetters: number | null;
};

/**
 * The share of attributable traffic that was refused, above which something is wrong rather than odd.
 *
 * A single refusal in a busy minute is a log group that was just unticked, or a clock that drifted. A
 * quarter of everything is a misconfiguration.
 */
export const DEGRADED_REJECT_SHARE = 0.25;

export function forwarderState(facts: ForwarderFactsInput): ForwarderState {
  if (!facts.managed) return 'not_installed';
  // Managed collection is on but nothing in the account has been confirmed: an operator who has not yet
  // run the stack, or one whose stack failed. Not an error until somebody says it should be there.
  if (!facts.verified) return 'unknown';

  // A batch that never arrived left no trace in OpsWatch's own counters, so the dead-letter queue is the
  // only evidence of total delivery failure — and it outranks everything below it.
  if (facts.deadLetters !== null && facts.deadLetters > 0) return 'error';

  if (facts.activeGroups === 0) return 'inactive';
  // Asked to forward, and nothing has ever arrived or been refused. Not a failure: OpsWatch has simply
  // not heard anything yet, and a quiet log group is the most ordinary thing in the world.
  if (facts.events === 0 && facts.rejected === 0) return 'unknown';
  if (facts.rejected > 0 && facts.rejected >= (facts.events + facts.rejected) * DEGRADED_REJECT_SHARE) return 'degraded';
  return facts.events > 0 ? 'healthy' : 'degraded';
}
