import 'server-only';
import { and, asc, desc, eq, gte, lt } from 'drizzle-orm';
import { randomId } from '../crypto';
import type { Db } from '../db/client';
import { syntheticChecks, syntheticRuns, type SyntheticCheckRow, type SyntheticRunRow } from '../db/schema';
import type { Assertion, RunOutcome } from '../detect/synthetic';

/**
 * Synthetic checks and their runs (§14).
 *
 * Secret headers get the same treatment as an integration credential: the listing has no ciphertext field,
 * one function named for the job returns it, and nothing else calls that function.
 */

/** A check as everything outside this file sees it: whether it has secret headers, never what they are. */
export type CheckView = Omit<SyntheticCheckRow, 'secretHeadersCiphertext' | 'assertions'> & {
  hasSecretHeaders: boolean;
  assertions: Assertion[];
};

function toView(row: SyntheticCheckRow): CheckView {
  const { secretHeadersCiphertext, assertions, ...rest } = row;
  return { ...rest, hasSecretHeaders: secretHeadersCiphertext !== null, assertions: assertions as Assertion[] };
}

export function listChecks(db: Db, connectionId: string, scope: string): CheckView[] {
  return db
    .select()
    .from(syntheticChecks)
    .where(and(eq(syntheticChecks.connectionId, connectionId), eq(syntheticChecks.scope, scope)))
    .orderBy(asc(syntheticChecks.name))
    .all()
    .map(toView);
}

export function enabledChecks(db: Db, connectionId: string, scope: string): CheckView[] {
  return listChecks(db, connectionId, scope).filter((check) => check.enabled);
}

export function findCheck(db: Db, id: string): CheckView | null {
  const row = db.select().from(syntheticChecks).where(eq(syntheticChecks.id, id)).get();
  return row === undefined ? null : toView(row);
}

/** The only function that returns the encrypted headers, named so its callers are a one-identifier search. */
export function secretHeadersFor(db: Db, id: string): string | null {
  return (
    db.select({ value: syntheticChecks.secretHeadersCiphertext }).from(syntheticChecks).where(eq(syntheticChecks.id, id)).get()?.value ?? null
  );
}

export type NewCheck = {
  connectionId: string;
  scope: string;
  name: string;
  url: string;
  method?: SyntheticCheckRow['method'];
  enabled: boolean;
  assertions: Assertion[];
  latencyThresholdMs?: number | null;
  intervalMinutes?: number;
  /** Already encrypted by the caller; this file never sees a plaintext header value. */
  secretHeadersCiphertext?: string | null;
};

export function upsertCheck(db: Db, input: NewCheck, nowMs: number): CheckView {
  const existing = db
    .select()
    .from(syntheticChecks)
    .where(
      and(
        eq(syntheticChecks.connectionId, input.connectionId),
        eq(syntheticChecks.scope, input.scope),
        eq(syntheticChecks.name, input.name),
      ),
    )
    .get();

  if (existing !== undefined) {
    const row = db
      .update(syntheticChecks)
      .set({
        url: input.url,
        method: input.method ?? existing.method,
        enabled: input.enabled,
        assertions: input.assertions,
        latencyThresholdMs: input.latencyThresholdMs ?? null,
        intervalMinutes: input.intervalMinutes ?? existing.intervalMinutes,
        // Absent headers leave the stored ones alone, so saving a form cannot silently clear a secret.
        ...(input.secretHeadersCiphertext === undefined ? {} : { secretHeadersCiphertext: input.secretHeadersCiphertext }),
      })
      .where(eq(syntheticChecks.id, existing.id))
      .returning()
      .get();
    return toView(row);
  }

  const row = db
    .insert(syntheticChecks)
    .values({
      id: randomId(),
      connectionId: input.connectionId,
      scope: input.scope,
      name: input.name,
      url: input.url,
      method: input.method ?? 'GET',
      enabled: input.enabled,
      assertions: input.assertions,
      secretHeadersCiphertext: input.secretHeadersCiphertext ?? null,
      latencyThresholdMs: input.latencyThresholdMs ?? null,
      intervalMinutes: input.intervalMinutes ?? 5,
      createdAt: nowMs,
    })
    .returning()
    .get();
  return toView(row);
}

/**
 * Removes one check, **and the environment it must belong to**.
 *
 * The environment is a parameter rather than the caller's responsibility on purpose. The id arrives in a
 * form field, and a delete that trusted it alone would let a post from one AWS connection's page destroy
 * a check — and, by cascade, its entire run history — belonging to another account in the same
 * installation. Making the scope part of the signature means no future caller can forget it.
 *
 * Returns the number of rows removed, so a caller can tell "deleted" from "not yours".
 */
export function deleteCheck(db: Db, connectionId: string, scope: string, id: string): number {
  // Runs cascade: a check that is gone must not leave orphaned history nobody can attribute.
  return db
    .delete(syntheticChecks)
    .where(and(eq(syntheticChecks.id, id), eq(syntheticChecks.connectionId, connectionId), eq(syntheticChecks.scope, scope)))
    .run().changes;
}

export type NewRun = {
  checkId: string;
  at: number;
  ok: boolean;
  status?: number | null;
  totalMs?: number | null;
  dnsMs?: number | null;
  tlsMs?: number | null;
  ttfbMs?: number | null;
  bodyBytes?: number | null;
  certificateExpiresAt?: number | null;
  failureReason?: string | null;
  assertionResults: unknown[];
};

export function recordRun(db: Db, input: NewRun): SyntheticRunRow {
  return db
    .insert(syntheticRuns)
    .values({
      id: randomId(),
      checkId: input.checkId,
      at: input.at,
      ok: input.ok,
      status: input.status ?? null,
      totalMs: input.totalMs ?? null,
      dnsMs: input.dnsMs ?? null,
      tlsMs: input.tlsMs ?? null,
      ttfbMs: input.ttfbMs ?? null,
      bodyBytes: input.bodyBytes ?? null,
      certificateExpiresAt: input.certificateExpiresAt ?? null,
      failureReason: input.failureReason ?? null,
      assertionResults: input.assertionResults,
    })
    .returning()
    .get();
}

/** The most recent runs of one check, newest first, for the rules that read a history. */
export function recentRuns(db: Db, checkId: string, limit: number): SyntheticRunRow[] {
  return db
    .select()
    .from(syntheticRuns)
    .where(eq(syntheticRuns.checkId, checkId))
    .orderBy(desc(syntheticRuns.at), desc(syntheticRuns.seq))
    .limit(limit)
    .all();
}

/** The projection §14's rules read. Narrowed here, so a rule cannot reach for a field it has no business in. */
export function toOutcome(row: SyntheticRunRow): RunOutcome {
  return { at: row.at, ok: row.ok, totalMs: row.totalMs };
}

/**
 * Every run of one check inside a window, oldest first.
 *
 * Bounded by the window rather than by a count, because a report asks "what happened in these seven days",
 * and a limit would silently answer with a different period for a check that runs every minute.
 */
export function runsBetween(db: Db, checkId: string, fromMs: number, toMs: number): SyntheticRunRow[] {
  return db
    .select()
    .from(syntheticRuns)
    .where(and(eq(syntheticRuns.checkId, checkId), gte(syntheticRuns.at, fromMs), lt(syntheticRuns.at, toMs)))
    .orderBy(asc(syntheticRuns.at), asc(syntheticRuns.seq))
    .all();
}

export function deleteRunsBefore(db: Db, beforeMs: number): number {
  return db.delete(syntheticRuns).where(lt(syntheticRuns.at, beforeMs)).run().changes;
}
