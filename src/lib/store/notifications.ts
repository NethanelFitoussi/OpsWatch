import 'server-only';
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { decrypt, encrypt, randomId, randomToken } from '../crypto';
import type { Db } from '../db/client';
import { notifyDeliveries, notifyDestinations, type NotifyDeliveryRow, type NotifyDestinationRow } from '../db/schema';

/**
 * Where alerts may be sent, and what happened when they were.
 *
 * The signing secret never leaves this file except through `secretOf`, which the delivery path is the
 * only caller of. Nothing that builds a page can reach it, which is the same shape every other credential
 * in OpsWatch has.
 */

/** What a page may see about a destination: everything except the secret. */
export type DestinationView = Omit<NotifyDestinationRow, 'secretCiphertext'>;

const toView = ({ secretCiphertext: _secret, ...rest }: NotifyDestinationRow): DestinationView => rest;

export function listDestinations(db: Db): DestinationView[] {
  return db.select().from(notifyDestinations).all().map(toView);
}

/**
 * The destinations one environment's alerts may reach: the unscoped ones, plus that connection's own.
 *
 * Unscoped destinations are the default and the whole meaning of a single-account installation — one
 * endpoint, every alert. Filtering here rather than at the caller is what stops the other case: with a
 * second AWS account connected for somebody else, every enabled destination used to receive every
 * environment's alerts, so Client A's problems arrived at Client B's endpoint.
 */
export function destinationsFor(db: Db, connectionId: string): DestinationView[] {
  return listDestinations(db).filter((destination) => destination.connectionId === null || destination.connectionId === connectionId);
}

export function findDestination(db: Db, id: string): DestinationView | null {
  const row = db.select().from(notifyDestinations).where(eq(notifyDestinations.id, id)).get();
  return row === undefined ? null : toView(row);
}

/**
 * Creates a destination and returns its signing secret **once**.
 *
 * The caller shows it and forgets it. A page that could re-read it is a page that could leak it, and a
 * receiver that has lost it can be given a new destination.
 */
export function createDestination(
  db: Db,
  input: { name: string; url: string; connectionId?: string | null },
  secret: string,
  nowMs: number,
): { destination: DestinationView; signingSecret: string } {
  const signingSecret = randomToken(32);
  const row = db
    .insert(notifyDestinations)
    .values({
      id: randomId(),
      kind: 'webhook',
      name: input.name,
      url: input.url,
      // `null` unless the operator chose an account: one endpoint for everything is the right default
      // for the installation that has one account, which is most of them.
      connectionId: input.connectionId ?? null,
      secretCiphertext: encrypt(signingSecret, secret, 'webhook'),
      enabled: true,
      createdAt: nowMs,
      consecutiveFailures: 0,
    })
    .returning()
    .get();
  return { destination: toView(row), signingSecret };
}

/** The one accessor for the signing secret. Nothing that renders a page calls it. */
export function secretOf(db: Db, id: string, secret: string): string | null {
  const row = db.select().from(notifyDestinations).where(eq(notifyDestinations.id, id)).get();
  return row === undefined ? null : decrypt(row.secretCiphertext, secret, 'webhook');
}

export function setDestinationEnabled(db: Db, id: string, enabled: boolean): void {
  db.update(notifyDestinations).set({ enabled }).where(eq(notifyDestinations.id, id)).run();
}

export function deleteDestination(db: Db, id: string): void {
  db.delete(notifyDestinations).where(eq(notifyDestinations.id, id)).run();
}

export function recordAttempt(db: Db, id: string, outcome: { ok: boolean; error?: string; atMs: number }): void {
  const row = db.select().from(notifyDestinations).where(eq(notifyDestinations.id, id)).get();
  if (row === undefined) return;
  db.update(notifyDestinations)
    .set({
      lastResult: outcome.ok ? 'ok' : 'failed',
      lastAttemptAt: outcome.atMs,
      lastError: outcome.ok ? null : (outcome.error ?? 'unknown'),
      // Counted rather than replaced: one failure is a blip, five in a row is a destination that has
      // stopped working, and only the count can tell them apart.
      consecutiveFailures: outcome.ok ? 0 : row.consecutiveFailures + 1,
    })
    .where(eq(notifyDestinations.id, id))
    .run();
}

export function queueDelivery(db: Db, input: { destinationId: string; alertId: string; payload: Record<string, unknown>; nowMs: number }): NotifyDeliveryRow {
  return db
    .insert(notifyDeliveries)
    .values({
      id: randomId(),
      destinationId: input.destinationId,
      alertId: input.alertId,
      payload: input.payload,
      attempts: 0,
      status: 'pending',
      createdAt: input.nowMs,
      nextAttemptAt: input.nowMs,
    })
    .returning()
    .get();
}

/** Everything due: never attempted, or waiting on a backoff that has now passed. */
export function dueDeliveries(db: Db, nowMs: number, limit: number): NotifyDeliveryRow[] {
  return db
    .select()
    .from(notifyDeliveries)
    .where(and(eq(notifyDeliveries.status, 'pending'), or(isNull(notifyDeliveries.nextAttemptAt), lte(notifyDeliveries.nextAttemptAt, nowMs))))
    .limit(limit)
    .all();
}

export function recordDelivery(
  db: Db,
  id: string,
  outcome: { status: 'pending' | 'ok' | 'failed'; attempts: number; error?: string; nextAttemptAt: number | null; nowMs: number },
): void {
  db.update(notifyDeliveries)
    .set({
      status: outcome.status,
      attempts: outcome.attempts,
      lastError: outcome.error ?? null,
      nextAttemptAt: outcome.nextAttemptAt,
      deliveredAt: outcome.status === 'ok' ? outcome.nowMs : null,
    })
    .where(eq(notifyDeliveries.id, id))
    .run();
}

export function listDeliveries(db: Db, destinationId: string, limit: number): NotifyDeliveryRow[] {
  return db.select().from(notifyDeliveries).where(eq(notifyDeliveries.destinationId, destinationId)).limit(limit).all();
}
