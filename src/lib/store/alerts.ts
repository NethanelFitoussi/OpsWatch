import 'server-only';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { randomId } from '../crypto';
import type { Db } from '../db/client';
import { alertRules, alerts, type AlertRow, type AlertRuleRow } from '../db/schema';
import { DEFAULT_COOLDOWN_SECONDS, INSTALL_RULES, type Rule } from '../detect/alert';

/**
 * Alert rules and the alerts they raise (§15).
 *
 * The one open alert per dedupe key is enforced by a partial unique index rather than by care: a second
 * writer racing the first fails loudly instead of quietly doubling an alert, which is the same reasoning
 * as the `problems_open_key` index.
 */

export function listRules(db: Db, connectionId: string, scope: string): AlertRuleRow[] {
  return db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.connectionId, connectionId), eq(alertRules.scope, scope)))
    .orderBy(asc(alertRules.name))
    .all();
}

/** The projection the pure rules read, so a rule cannot reach for a column it has no business in. */
export function toRule(row: AlertRuleRow): Rule {
  return {
    id: row.id,
    enabled: row.enabled,
    condition: row.condition,
    minSeverity: row.minSeverity,
    kinds: row.kinds,
    cooldownSeconds: row.cooldownSeconds,
  };
}

/**
 * Creates §15.1's install rules for an environment that has none.
 *
 * Idempotent, and it never revives a rule somebody deleted on purpose: it only acts when the environment
 * has no rules at all. An installation that has been curated stays curated.
 */
export function ensureInstallRules(db: Db, connectionId: string, scope: string, nowMs: number): number {
  if (listRules(db, connectionId, scope).length > 0) return 0;

  let created = 0;
  for (const installed of INSTALL_RULES) {
    db.insert(alertRules)
      .values({
        id: randomId(),
        connectionId,
        scope,
        name: installed.name,
        enabled: true,
        condition: installed.condition,
        minSeverity: installed.minSeverity,
        kinds: installed.kinds,
        // §15: in-app and nothing else, so installing OpsWatch never sends anything outside the instance.
        channels: ['in_app'],
        cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
        origin: 'auto',
        createdAt: nowMs,
      })
      .run();
    created += 1;
  }
  return created;
}

export function setRuleEnabled(db: Db, id: string, enabled: boolean): void {
  db.update(alertRules).set({ enabled }).where(eq(alertRules.id, id)).run();
}

export function findOpenAlert(db: Db, dedupeKey: string): AlertRow | null {
  return db.select().from(alerts).where(and(eq(alerts.dedupeKey, dedupeKey), isNull(alerts.resolvedAt))).get() ?? null;
}

export type NewAlert = {
  connectionId: string;
  scope: string;
  ruleId: string;
  dedupeKey: string;
  problemId: string | null;
  titleKey: string;
  values: Record<string, string | number>;
  severity: AlertRow['severity'];
  at: number;
};

export function openAlert(db: Db, input: NewAlert): AlertRow {
  return db
    .insert(alerts)
    .values({
      id: randomId(),
      connectionId: input.connectionId,
      scope: input.scope,
      ruleId: input.ruleId,
      dedupeKey: input.dedupeKey,
      problemId: input.problemId,
      titleKey: input.titleKey,
      values: input.values,
      severity: input.severity,
      status: 'firing',
      firstFiredAt: input.at,
      lastFiredAt: input.at,
      suppressedCount: 0,
      acknowledgedAt: null,
      acknowledgedBy: null,
      resolvedAt: null,
    })
    .returning()
    .get();
}

/** A fire that was announced: the timestamp moves and nothing is counted as suppressed. */
export function refireAlert(db: Db, id: string, at: number): void {
  db.update(alerts).set({ lastFiredAt: at }).where(eq(alerts.id, id)).run();
}

/** A fire inside the cooldown: counted, so the silence is visible rather than merely quiet (§15.2). */
export function suppressAlert(db: Db, id: string, at: number): void {
  db.update(alerts)
    .set({ lastFiredAt: at, suppressedCount: sql`${alerts.suppressedCount} + 1` })
    .where(eq(alerts.id, id))
    .run();
}

export function acknowledgeAlert(db: Db, id: string, at: number, actorId: string): void {
  db.update(alerts).set({ status: 'acknowledged', acknowledgedAt: at, acknowledgedBy: actorId }).where(eq(alerts.id, id)).run();
}

/**
 * Resolves every open alert whose subject is no longer alerting.
 *
 * Takes the keys that *are* still alerting rather than the ones that are not, so an alert whose subject
 * vanished entirely resolves too — a subject nobody is evaluating any more is not one that is still firing.
 */
export function resolveAlertsExcept(db: Db, connectionId: string, scope: string, stillFiring: ReadonlySet<string>, at: number): number {
  const open = db
    .select()
    .from(alerts)
    .where(and(eq(alerts.connectionId, connectionId), eq(alerts.scope, scope), isNull(alerts.resolvedAt)))
    .all();

  let resolved = 0;
  for (const alert of open) {
    if (stillFiring.has(alert.dedupeKey)) continue;
    db.update(alerts).set({ status: 'resolved', resolvedAt: at }).where(eq(alerts.id, alert.id)).run();
    resolved += 1;
  }
  return resolved;
}

export function listAlerts(db: Db, connectionId: string, scope: string, limit: number): AlertRow[] {
  return db
    .select()
    .from(alerts)
    .where(and(eq(alerts.connectionId, connectionId), eq(alerts.scope, scope)))
    .orderBy(desc(alerts.lastFiredAt), desc(alerts.seq))
    .limit(limit)
    .all();
}

