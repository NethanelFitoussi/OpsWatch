import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { randomId } from '../crypto';
import type { Db } from '../db/client';
import { sloDefinitions, type SloDefinitionRow } from '../db/schema';

/**
 * Service level objectives, as an operator defined them (§19).
 *
 * Rows only. Nothing here measures anything: the arithmetic lives in `lib/detect/slo.ts` and the reading
 * in `lib/read/slos.ts`, so changing an objective never rewrites a figure that was already computed — the
 * next read simply measures the same stored history against the new target.
 */

export function listSloDefinitions(db: Db, connectionId: string, scope: string): SloDefinitionRow[] {
  return db
    .select()
    .from(sloDefinitions)
    .where(and(eq(sloDefinitions.connectionId, connectionId), eq(sloDefinitions.scope, scope)))
    .orderBy(asc(sloDefinitions.name))
    .all();
}

function enabledSloDefinitions(db: Db, connectionId: string, scope: string): SloDefinitionRow[] {
  return listSloDefinitions(db, connectionId, scope).filter((definition) => definition.enabled);
}

export type NewSloDefinition = {
  connectionId: string;
  scope: string;
  name: string;
  kind: SloDefinitionRow['kind'];
  subjectId: string;
  objective: number;
  latencyThresholdMs: number | null;
  windowDays: number;
  enabled: boolean;
};

/**
 * Creates or updates a definition, keyed by its name within the environment.
 *
 * The name is the identity because that is what an operator edits by: re-saving "Checkout availability"
 * with a stricter target is a change to the same objective, not a second one competing with it.
 */
export function upsertSloDefinition(db: Db, input: NewSloDefinition, nowMs: number): SloDefinitionRow {
  const existing = db
    .select()
    .from(sloDefinitions)
    .where(
      and(
        eq(sloDefinitions.connectionId, input.connectionId),
        eq(sloDefinitions.scope, input.scope),
        eq(sloDefinitions.name, input.name),
      ),
    )
    .get();

  if (existing !== undefined) {
    return db
      .update(sloDefinitions)
      .set({
        kind: input.kind,
        subjectId: input.subjectId,
        objective: input.objective,
        latencyThresholdMs: input.latencyThresholdMs,
        windowDays: input.windowDays,
        enabled: input.enabled,
      })
      .where(eq(sloDefinitions.id, existing.id))
      .returning()
      .get();
  }

  return db
    .insert(sloDefinitions)
    .values({ ...input, id: randomId(), createdAt: nowMs })
    .returning()
    .get();
}

export function deleteSloDefinition(db: Db, id: string): void {
  db.delete(sloDefinitions).where(eq(sloDefinitions.id, id)).run();
}

/**
 * The objective to measure one subject against, and whether anybody chose it.
 *
 * A report that has no definition still needs a number, and `null` here is what lets the caller say the
 * figure is against a default rather than against a target somebody set — §2.6's distinction between a
 * measurement and an assumption, applied to the objective itself.
 */
export function objectiveFor(db: Db, connectionId: string, scope: string, subjectId: string): SloDefinitionRow | null {
  return (
    enabledSloDefinitions(db, connectionId, scope).find(
      (definition) => definition.kind === 'availability' && definition.subjectId === subjectId,
    ) ?? null
  );
}
