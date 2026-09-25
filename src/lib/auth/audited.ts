import 'server-only';
import { headers } from 'next/headers';
import { getDb } from '../db/client';
import { appendAudit, type AuditAction } from '../store/audit';
import { requireAdmin } from './current';

/**
 * An administrator action, recorded (§21).
 *
 * One helper rather than the same eight lines in every action file, so that "which actions are audited?"
 * is answered by searching for one identifier — and so that a new action file which forgets to record
 * itself is visibly different from the ones that do, rather than subtly identical.
 *
 * The outcome is **read from the result** rather than declared separately. Every server action in this
 * codebase returns an `ActionState`, where a validation refusal is `{ error }` and success is anything
 * else, so the helper can tell `denied` from `ok` without each caller restating what it already returned —
 * and without any caller being able to record a refusal as a success by mistake.
 */

/**
 * What every audited action returns: a refusal carries `error`, and nothing else does.
 *
 * Constrained to `object` rather than to `{ error?: string }`, because the latter is a *weak type* — one
 * with only optional properties — and TypeScript rejects any argument sharing none of them. A success like
 * `{ saved: true }` shares nothing with it, which would make the honest success case the one that fails to
 * compile. The `error` field is read through a narrowing instead.
 */
function refusalReason(result: object): string | undefined {
  const error = (result as { error?: unknown }).error;
  return typeof error === 'string' ? error : undefined;
}

/** The address and device of the caller, as §21 asks them to be recorded. */
async function callerContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  const list = await headers();
  return {
    // Behind a reverse proxy the first hop is the client; `x-real-ip` is the common single-value form.
    ip: list.get('x-forwarded-for')?.split(',')[0]?.trim() ?? list.get('x-real-ip'),
    userAgent: list.get('user-agent'),
  };
}

/**
 * `redirect()` and `notFound()` work by throwing.
 *
 * Next.js signals both with a thrown error carrying a `digest`, which is ordinary control flow and not a
 * failure — but it reaches a `catch` looking exactly like one, and an action that ends by redirecting
 * would be written into the log as having failed. The audit log is evidence; a row saying an
 * administrator's successful change failed is worse than no row at all.
 */
function isControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND');
}

/**
 * One administrator action, written down.
 *
 * Separate from `auditedAdmin` because some actions only learn what they acted on *inside* the change —
 * creating a connection does not know its id until it exists — and because some never return at all,
 * ending in a redirect. Those record here, where both facts are known.
 */
export async function recordAdminAction(entry: {
  adminId: number;
  action: AuditAction;
  subjectType: string;
  subjectId?: string | null;
  connectionId?: string | null;
  result: 'ok' | 'denied' | 'failed';
  details?: Record<string, string | number | boolean>;
}): Promise<void> {
  const caller = await callerContext();
  appendAudit(getDb(), {
    at: Date.now(),
    actorUserId: entry.adminId,
    actorKind: 'user',
    action: entry.action,
    subjectType: entry.subjectType,
    connectionId: entry.connectionId ?? null,
    subjectId: entry.subjectId ?? null,
    result: entry.result,
    ip: caller.ip,
    userAgent: caller.userAgent,
    details: entry.details ?? {},
  });
}

/**
 * Which connected AWS account an action was about, when it was about one.
 *
 * Passed rather than inferred: a server action under `/c/[connectionId]` knows its account from its own
 * parameters, and guessing it here from the subject id would be right for connection actions and wrong
 * for every log source, rule and check — the ones an account review actually turns on.
 */
export type AuditScope = { subjectId?: string | null; connectionId?: string | null };

export async function auditedAdmin<T extends object>(
  locale: string,
  action: AuditAction,
  subjectType: string,
  run: (adminId: number) => Promise<T>,
  scope?: string | null | AuditScope,
): Promise<T> {
  const { subjectId, connectionId } =
    scope === undefined || scope === null || typeof scope === 'string' ? { subjectId: scope, connectionId: null } : scope;
  const adminId = await requireAdmin(locale);
  const caller = await callerContext();
  const db = getDb();

  const record = (result: 'ok' | 'denied' | 'failed', details: Record<string, string | number | boolean> = {}) =>
    appendAudit(db, {
      at: Date.now(),
      actorUserId: adminId,
      actorKind: 'user',
      action,
      subjectType,
      connectionId: connectionId ?? null,
      subjectId: subjectId ?? null,
      result,
      ip: caller.ip,
      userAgent: caller.userAgent,
      details,
    });

  try {
    const result = await run(adminId);
    // A form action that returned a validation error was *refused*, not failed. The two read very
    // differently to somebody reviewing a log, and reading it from the result means no caller can get it
    // wrong by restating something it has already said.
    const refusal = refusalReason(result);
    record(refusal === undefined ? 'ok' : 'denied', refusal === undefined ? {} : { reason: refusal });
    return result;
  } catch (error) {
    // Recorded before it is rethrown, so a crash mid-action is a row rather than a silence — but a
    // redirect is how a successful action ends, not how one fails.
    // The error's *name*, never its message: a message can carry a path, a query or a credential.
    if (isControlFlow(error)) record('ok');
    else record('failed', { error: error instanceof Error ? error.name : 'unknown' });
    throw error;
  }
}
