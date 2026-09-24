import 'server-only';
import { encrypt } from '../crypto';
import type { Db } from '../db/client';
import { env } from '../env';
import { describeForwarder } from './forwarder-health';
import { filterNameFor } from '../monitoring/shared/filter-name';
import { decideSubscription, failureOf, type SubscriptionFailure } from '../monitoring/shared/subscription-conflict';
import { deleteSubscription, describeSubscriptions, putSubscription } from '../monitoring/subscriptions';
import { resolveTarget } from '../monitoring/target';
import {
  deleteForwardedGroup,
  deleteIngestEvents,
  findCollection,
  listForwardedGroups,
  newIngestSecret,
  readCollection,
  upsertForwardedGroup,
  writeCollection,
} from '../store/collection';

/**
 * Turning managed collection on and off, and choosing what is forwarded.
 *
 * Every function here is the *whole* of one operator decision, so a half-applied state is not something a
 * caller has to remember to clean up. Turning the feature off removes the subscriptions before it
 * forgets the secret, because a subscription pointing at a forwarder nobody will authenticate is an
 * invocation somebody pays for and nothing receives.
 */

/**
 * Enables managed collection and issues the signing secret.
 *
 * The secret is returned **once**, to the caller who asked for it, and stored encrypted under its own
 * purpose. Nothing returns it again: the account page renders it at the moment it is created and then
 * has no way to ask for it.
 *
 * Nothing is forwarded by this. It makes forwarding *possible*; a log group still has to be chosen.
 */
export function enableManagedCollection(db: Db, connectionId: string, nowMs: number): { secret: string } {
  const secret = newIngestSecret();
  writeCollection(
    db,
    connectionId,
    {
      managed: true,
      // Explicitly false: enabling the capability is not enabling the source, and a reader of this row
      // must never have to infer that from the absence of a field.
      realtimeLogs: false,
      ingestSecretCiphertext: encrypt(secret, env().OPSWATCH_SECRET, 'aws-ingest'),
      secretRotatedAt: nowMs,
      stackState: 'declared',
    },
    nowMs,
  );
  return { secret };
}

/** A new secret for the same integration. The old one stops working the moment this returns. */
export function rotateIngestSecret(db: Db, connectionId: string, nowMs: number): { secret: string } {
  const secret = newIngestSecret();
  writeCollection(db, connectionId, { ingestSecretCiphertext: encrypt(secret, env().OPSWATCH_SECRET, 'aws-ingest'), secretRotatedAt: nowMs }, nowMs);
  return { secret };
}

export type DisableOutcome = {
  /** Log groups whose subscription OpsWatch removed. */
  removed: string[];
  /** Log groups it could not reach, which the operator is told about rather than left to discover. */
  failed: string[];
};

/**
 * Turns managed collection off, completely.
 *
 * In this order, and the order matters:
 *
 *   1. remove every subscription OpsWatch created, so nothing new is sent;
 *   2. forget the secret, so anything still in flight cannot authenticate;
 *   3. drop the queued and kept records, because they were only ever here to be processed;
 *   4. leave the **base integration exactly as it was**. Direct mode keeps working, the account stays
 *      connected, and nothing about reading AWS changes.
 *
 * A subscription OpsWatch could not remove is reported rather than swallowed: it is an invocation the
 * operator is paying for, and they need to know to delete the stack or the filter themselves.
 */
export async function disableManagedCollection(db: Db, connectionId: string, nowMs: number): Promise<DisableOutcome> {
  const outcome: DisableOutcome = { removed: [], failed: [] };
  // Nobody ever touched the feature for this connection, so there is nothing to turn off — and writing a
  // row here would create settings for a connection that may be on its way out.
  if (findCollection(db, connectionId) === undefined) return outcome;

  for (const group of listForwardedGroups(db, connectionId)) {
    const stopped = await stopForwarding(db, connectionId, group.region, group.logGroup, nowMs);
    (stopped.ok ? outcome.removed : outcome.failed).push(group.logGroup);
  }

  writeCollection(
    db,
    connectionId,
    { managed: false, realtimeLogs: false, ingestSecretCiphertext: null, secretRotatedAt: null, stackState: 'absent', forwarderArn: null, forwarderVersion: null, verifiedAt: null },
    nowMs,
  );
  deleteIngestEvents(db, connectionId);
  return outcome;
}

export type ForwardOutcome =
  | { ok: true; state: 'active' }
  | { ok: false; reason: SubscriptionFailure; owner?: string };

/**
 * Starts forwarding one log group.
 *
 * It reads what is already on the group first, every time. A group carrying another vendor's forwarder is
 * left exactly as it was found and the conflict is named, because "it did not work" is not something an
 * operator can act on.
 */
export async function startForwarding(
  db: Db,
  connectionId: string,
  region: string,
  logGroup: string,
  nowMs: number,
): Promise<ForwardOutcome> {
  const collection = readCollection(db, connectionId);
  const destinationArn = collection.forwarderArn;
  if (!collection.managed || destinationArn === null) return { ok: false, reason: 'not_found' };

  const target = await resolveTarget({ connectionId, region });
  if (!target.ok) return { ok: false, reason: 'denied' };

  const existing = await describeSubscriptions(target.data, logGroup);
  if (!existing.ok) return { ok: false, reason: failureOf(existing.code) };

  const ours = filterNameFor(connectionId);
  const decision = decideSubscription(existing.data, ours, destinationArn);
  if (decision.kind === 'conflict') {
    upsertForwardedGroup(db, { connectionId, region, logGroup, filterName: ours, state: 'failed', lastError: 'conflict' }, nowMs);
    return { ok: false, reason: 'conflict', owner: decision.owner };
  }

  if (decision.kind !== 'already') {
    const put = await putSubscription(target.data, { logGroup, filterName: ours, destinationArn });
    if (!put.ok) {
      const reason = failureOf(put.code);
      upsertForwardedGroup(db, { connectionId, region, logGroup, filterName: ours, state: 'failed', lastError: reason }, nowMs);
      return { ok: false, reason };
    }
  }

  upsertForwardedGroup(db, { connectionId, region, logGroup, filterName: ours, state: 'active', lastError: null }, nowMs);
  return { ok: true, state: 'active' };
}

/**
 * Stops forwarding one log group.
 *
 * The row goes whatever AWS says, because a row claiming OpsWatch is forwarding a group it is not would
 * be worse than no row — but the failure is returned, so the operator is told the filter is still there
 * and still costing them invocations.
 */
export async function stopForwarding(
  db: Db,
  connectionId: string,
  region: string,
  logGroup: string,
  nowMs: number,
): Promise<{ ok: boolean; reason?: SubscriptionFailure }> {
  void nowMs;
  const target = await resolveTarget({ connectionId, region });
  if (!target.ok) {
    deleteForwardedGroup(db, connectionId, region, logGroup);
    return { ok: false, reason: 'denied' };
  }

  const removed = await deleteSubscription(target.data, { logGroup, filterName: filterNameFor(connectionId) });
  deleteForwardedGroup(db, connectionId, region, logGroup);
  // A filter that was not there is a filter that is not there now, which is what was asked for.
  if (!removed.ok && failureOf(removed.code) !== 'not_found') return { ok: false, reason: failureOf(removed.code) };
  return { ok: true };
}

/**
 * Confirms against AWS what a browser claimed, and records the version the function itself reports.
 *
 * Until this succeeds the stack is `declared`: somebody said it is there. Afterwards it is `verified`,
 * and the difference is on the page rather than buried in a column nobody renders.
 */
export async function verifyForwarder(
  db: Db,
  connectionId: string,
  region: string,
  functionArn: string,
  nowMs: number,
): Promise<{ ok: boolean; version?: string | null }> {
  const target = await resolveTarget({ connectionId, region });
  if (!target.ok) return { ok: false };

  const facts = await describeForwarder(target.data, functionArn);
  if (!facts.ok) {
    writeCollection(db, connectionId, { stackState: 'stale', forwarderArn: functionArn }, nowMs);
    return { ok: false };
  }
  writeCollection(
    db,
    connectionId,
    { stackState: 'verified', forwarderArn: functionArn, forwarderVersion: facts.data.version, verifiedAt: nowMs },
    nowMs,
  );
  return { ok: true, version: facts.data.version };
}
