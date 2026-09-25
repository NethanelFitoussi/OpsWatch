import 'server-only';
import { and, desc, eq, gte, lt, type SQL } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { randomId } from '../crypto';
import type { Db } from '../db/client';
import { auditLog, type AuditLogRow } from '../db/schema';

/**
 * The administrative audit log (§21).
 *
 * **This file contains no update and no delete.** That is the feature: a log somebody can edit is not
 * evidence, and the only way to be sure of it is for the statements not to exist. Even retention writes an
 * entry rather than removing others — §21 is explicit that the purge records itself.
 *
 * A reviewer checking that claim reads this file and finds `insert` and `select`, and nothing else.
 */

/** §21's actions. A closed list, so a typo becomes a compile error rather than an unfindable row. */
export const AUDIT_ACTIONS = [
  'sign_in',
  'sign_out',
  'setup_admin',
  'connection_create',
  'connection_update',
  'connection_delete',
  'connection_test',
  'credential_rotate',
  'token_create',
  'token_revoke',
  'settings_update',
  'retention_update',
  'history_update',
  'log_source_update',
  'repository_update',
  'integration_update',
  'ai_update',
  'ai_test',
  'cloudflare_update',
  'cloudflare_test',
  'notify_update',
  'notify_test',
  'synthetic_update',
  'alert_rule_update',
  'slo_update',
  'alert_acknowledge',
  'incident_dismiss',
  'export_download',
  'retention_purge',
  // A Linux host: enrolling one mints a signing secret, and removing one destroys its readings.
  'host_enrol',
  'host_update',
  'host_remove',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * A user agent, reduced to something that tells two devices apart and fingerprints neither.
 *
 * §21 asks for a hash rather than the string. The whole string in an audit row is a record of somebody's
 * browser, operating system and often their device model, kept forever — more than the log needs to do its
 * job, which is to say "the same device as last time" or "a different one".
 */
export function hashUserAgent(userAgent: string | null): string | null {
  if (userAgent === null || userAgent.trim() === '') return null;
  return createHash('sha256').update(userAgent).digest('hex').slice(0, 32);
}

export type AuditEntry = {
  at: number;
  actorUserId: number | null;
  actorKind: AuditLogRow['actorKind'];
  action: AuditAction;
  subjectType?: string | null;
  subjectId?: string | null;
  result: AuditLogRow['result'];
  ip?: string | null;
  userAgent?: string | null;
  /** Never a credential, a token, or the content of an AI question (§21). */
  details?: Record<string, string | number | boolean>;
};

export function appendAudit(db: Db, entry: AuditEntry): AuditLogRow {
  return db
    .insert(auditLog)
    .values({
      id: randomId(),
      at: entry.at,
      actorUserId: entry.actorUserId,
      actorKind: entry.actorKind,
      action: entry.action,
      subjectType: entry.subjectType ?? null,
      subjectId: entry.subjectId ?? null,
      result: entry.result,
      ip: entry.ip ?? null,
      userAgentHash: hashUserAgent(entry.userAgent ?? null),
      details: entry.details ?? {},
    })
    .returning()
    .get();
}

export type AuditFilter = { action?: AuditAction; actorUserId?: number; sinceMs?: number; untilMs?: number };

/** Newest first, bounded. An audit log is read from the recent end and filtered, never paged to the start. */
export function listAudit(db: Db, filter: AuditFilter, limit: number): AuditLogRow[] {
  const where: SQL[] = [];
  if (filter.action !== undefined) where.push(eq(auditLog.action, filter.action));
  if (filter.actorUserId !== undefined) where.push(eq(auditLog.actorUserId, filter.actorUserId));
  if (filter.sinceMs !== undefined) where.push(gte(auditLog.at, filter.sinceMs));
  if (filter.untilMs !== undefined) where.push(lt(auditLog.at, filter.untilMs));

  const query = db.select().from(auditLog);
  return (where.length === 0 ? query : query.where(and(...where)))
    .orderBy(desc(auditLog.at), desc(auditLog.seq))
    .limit(limit)
    .all();
}

export function countAudit(db: Db): number {
  return db.select().from(auditLog).all().length;
}
