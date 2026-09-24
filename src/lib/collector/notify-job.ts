import 'server-only';
import type { Db } from '../db/client';
import { MAX_ATTEMPTS, deliver, nextAttemptAt, type DeliveryDeps } from '../notify/deliver';
import type { NotifyPayload } from '../notify/payload';
import { dueDeliveries, findDestination, recordAttempt, recordDelivery, secretOf } from '../store/notifications';
import type { JobOutcome } from './runner';

/**
 * Sending what the alert cycle queued, and retrying what fails.
 *
 * Separate from the cycle that decided, because deciding is fast and sending is not: a receiver that
 * takes ten seconds to answer must not hold a detect cycle open behind it.
 *
 * A delivery that exhausts its attempts stays in the table as a failure. It is not deleted and it is not
 * retried for ever — either would be a way for a broken destination to become invisible.
 */

/** How many are attempted per cycle, so one run cannot become unbounded. */
const NOTIFY_BATCH = 20;

export async function runNotifyJob(db: Db, secret: string, nowMs: number, deps: DeliveryDeps = {}): Promise<JobOutcome> {
  const due = dueDeliveries(db, nowMs, NOTIFY_BATCH);
  let sent = 0;

  for (const delivery of due) {
    const destination = findDestination(db, delivery.destinationId);
    const signingSecret = destination === null ? null : secretOf(db, destination.id, secret);
    const attempts = delivery.attempts + 1;

    // A destination that was deleted or switched off mid-flight is not a failure to retry; there is
    // simply nowhere to send it any more.
    if (destination === null || !destination.enabled || signingSecret === null) {
      recordDelivery(db, delivery.id, { status: 'failed', attempts, error: 'no_destination', nextAttemptAt: null, nowMs });
      continue;
    }

    const outcome = await deliver(destination, delivery.payload as NotifyPayload, signingSecret, { ...deps, nowMs });
    recordAttempt(db, destination.id, { ok: outcome.ok, error: outcome.error, atMs: nowMs });

    if (outcome.ok) {
      recordDelivery(db, delivery.id, { status: 'ok', attempts, nextAttemptAt: null, nowMs });
      sent += 1;
      continue;
    }
    const next = attempts >= MAX_ATTEMPTS ? null : nextAttemptAt(attempts, nowMs);
    recordDelivery(db, delivery.id, {
      status: next === null ? 'failed' : 'pending',
      attempts,
      error: outcome.error,
      nextAttemptAt: next,
      nowMs,
    });
  }

  return { covered: sent, total: due.length, truncated: due.length === NOTIFY_BATCH };
}
