import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { randomId } from '../crypto';
import type { Db } from '../db/client';
import {
  integrations,
  repositories,
  serviceRepositories,
  type IntegrationRow,
  type RepositoryRow,
  type ServiceRepositoryRow,
} from '../db/schema';

/**
 * Integrations, repositories and the mapping between a service and its code (§13).
 *
 * **The credential never leaves this file.** `listIntegrations` returns a projection with no ciphertext
 * field at all, so there is no read path a page could accidentally render and no object a log line could
 * accidentally serialise. Only `credentialFor` returns it, it is named so its one caller is obvious, and
 * nothing else in the product calls it.
 */

/** An integration as everything outside this file sees it: no credential, only whether there is one. */
export type IntegrationView = Omit<IntegrationRow, 'credentialCiphertext'> & { hasCredential: boolean };

function toView(row: IntegrationRow): IntegrationView {
  const { credentialCiphertext, ...rest } = row;
  return { ...rest, hasCredential: credentialCiphertext !== null };
}

export function listIntegrations(db: Db, kind?: IntegrationRow['kind']): IntegrationView[] {
  const rows = kind === undefined
    ? db.select().from(integrations).orderBy(asc(integrations.name)).all()
    : db.select().from(integrations).where(eq(integrations.kind, kind)).orderBy(asc(integrations.name)).all();
  return rows.map(toView);
}

/**
 * The stored ciphertext for one integration.
 *
 * The only function that returns it. Named for what it is so that a review of "who can read a credential"
 * is a search for one identifier.
 */
export function credentialFor(db: Db, id: string): string | null {
  return db.select({ value: integrations.credentialCiphertext }).from(integrations).where(eq(integrations.id, id)).get()?.value ?? null;
}

export type NewIntegration = {
  kind: IntegrationRow['kind'];
  name: string;
  /** Already encrypted by the caller: this file never sees a plaintext token. */
  credentialCiphertext?: string | null;
  /** The non-secret half — which model, which account. Absent leaves whatever is stored alone. */
  config?: Record<string, unknown> | null;
  /**
   * Whether this change makes the last test result meaningless.
   *
   * A new credential always does, and is assumed to. A config change depends on what changed: a different
   * model or endpoint is a different connection and must be proved again; choosing which zones to read is a
   * scope decision that says nothing about whether the token works. The caller knows which it made.
   */
  resetStatus?: boolean;
};

export function upsertIntegration(db: Db, input: NewIntegration, nowMs: number): IntegrationView {
  const existing = db
    .select()
    .from(integrations)
    .where(and(eq(integrations.kind, input.kind), eq(integrations.name, input.name)))
    .get();

  if (existing !== undefined) {
    // An absent credential leaves the stored one alone, so saving a form that does not include the token
    // cannot silently clear it. With nothing to change at all, nothing is written.
    if (input.credentialCiphertext === undefined && input.config === undefined) return toView(existing);

    const reset = input.resetStatus ?? input.credentialCiphertext !== undefined;
    const row = db
      .update(integrations)
      .set({
        ...(input.credentialCiphertext === undefined ? {} : { credentialCiphertext: input.credentialCiphertext }),
        ...(input.config === undefined ? {} : { config: input.config }),
        ...(reset ? { status: 'untested' as const, lastError: null } : {}),
      })
      .where(eq(integrations.id, existing.id))
      .returning()
      .get();
    return toView(row);
  }

  const row = db
    .insert(integrations)
    .values({
      id: randomId(),
      kind: input.kind,
      name: input.name,
      credentialCiphertext: input.credentialCiphertext ?? null,
      config: input.config ?? null,
      status: 'untested',
      createdAt: nowMs,
    })
    .returning()
    .get();
  return toView(row);
}

export function recordIntegrationTest(db: Db, id: string, result: { ok: boolean; error?: string }, nowMs: number): void {
  db.update(integrations)
    .set({
      status: result.ok ? 'configured' : 'failed',
      lastTestedAt: nowMs,
      // The reason is kept so a reader can act on it; it is a provider's message, never the credential.
      lastError: result.ok ? null : (result.error ?? 'unknown'),
    })
    .where(eq(integrations.id, id))
    .run();
}

/**
 * Removes an integration entirely — the row, the ciphertext and the status together.
 *
 * "Disconnect" has to mean the credential is gone, not that a flag was flipped. A row kept with its token
 * for the sake of the status history would be a secret OpsWatch was asked to forget and did not.
 */
export function deleteIntegration(db: Db, id: string): number {
  return db.delete(integrations).where(eq(integrations.id, id)).run().changes;
}

export function listRepositories(db: Db): RepositoryRow[] {
  return db.select().from(repositories).orderBy(asc(repositories.owner), asc(repositories.name)).all();
}

export function findRepository(db: Db, id: string): RepositoryRow | null {
  return db.select().from(repositories).where(eq(repositories.id, id)).get() ?? null;
}

export function upsertRepository(
  db: Db,
  input: { owner: string; name: string; defaultBranch?: string; integrationId?: string | null },
  nowMs: number,
): RepositoryRow {
  const existing = db
    .select()
    .from(repositories)
    .where(and(eq(repositories.owner, input.owner), eq(repositories.name, input.name)))
    .get();

  if (existing !== undefined) {
    return db
      .update(repositories)
      .set({
        ...(input.defaultBranch === undefined ? {} : { defaultBranch: input.defaultBranch }),
        ...(input.integrationId === undefined ? {} : { integrationId: input.integrationId }),
      })
      .where(eq(repositories.id, existing.id))
      .returning()
      .get();
  }

  return db
    .insert(repositories)
    .values({
      id: randomId(),
      owner: input.owner,
      name: input.name,
      defaultBranch: input.defaultBranch ?? 'main',
      integrationId: input.integrationId ?? null,
      createdAt: nowMs,
    })
    .returning()
    .get();
}

export function deleteRepository(db: Db, id: string): number {
  // The mapping cascades, so removing a repository cannot leave a service pointing at nothing.
  return db.delete(repositories).where(eq(repositories.id, id)).run().changes;
}

export function findMapping(db: Db, connectionId: string, scope: string, serviceId: string): ServiceRepositoryRow | null {
  return (
    db
      .select()
      .from(serviceRepositories)
      .where(
        and(
          eq(serviceRepositories.connectionId, connectionId),
          eq(serviceRepositories.scope, scope),
          eq(serviceRepositories.serviceId, serviceId),
        ),
      )
      .get() ?? null
  );
}

export function listMappings(db: Db, connectionId: string, scope: string): ServiceRepositoryRow[] {
  return db
    .select()
    .from(serviceRepositories)
    .where(and(eq(serviceRepositories.connectionId, connectionId), eq(serviceRepositories.scope, scope)))
    .orderBy(asc(serviceRepositories.serviceId))
    .all();
}

/**
 * Records that a service's code lives in a repository.
 *
 * `source` defaults to `declared` because that is what saving this means: a person decided. A suggestion is
 * only ever written here once somebody has accepted it, which is §13's rule that OpsWatch never applies one
 * automatically.
 */
export function setMapping(
  db: Db,
  input: {
    connectionId: string;
    scope: string;
    serviceId: string;
    repositoryId: string;
    pathPrefix?: string | null;
    source?: ServiceRepositoryRow['source'];
  },
  nowMs: number,
): ServiceRepositoryRow {
  const existing = findMapping(db, input.connectionId, input.scope, input.serviceId);
  if (existing !== null) {
    return db
      .update(serviceRepositories)
      .set({
        repositoryId: input.repositoryId,
        pathPrefix: input.pathPrefix ?? null,
        source: input.source ?? 'declared',
      })
      .where(eq(serviceRepositories.id, existing.id))
      .returning()
      .get();
  }

  return db
    .insert(serviceRepositories)
    .values({
      id: randomId(),
      connectionId: input.connectionId,
      scope: input.scope,
      serviceId: input.serviceId,
      repositoryId: input.repositoryId,
      pathPrefix: input.pathPrefix ?? null,
      source: input.source ?? 'declared',
      createdAt: nowMs,
    })
    .returning()
    .get();
}

export function clearMapping(db: Db, connectionId: string, scope: string, serviceId: string): number {
  return db
    .delete(serviceRepositories)
    .where(
      and(
        eq(serviceRepositories.connectionId, connectionId),
        eq(serviceRepositories.scope, scope),
        eq(serviceRepositories.serviceId, serviceId),
      ),
    )
    .run().changes;
}
