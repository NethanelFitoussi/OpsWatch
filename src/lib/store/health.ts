import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { familySnapshots, type FamilySnapshotRow, type FamilyStatus } from '../db/schema';

/**
 * What the last detect cycle saw of each family, so Health can answer from the database rather than from AWS.
 *
 * A snapshot, not a history: each cycle replaces the row. History is the events spine's job.
 */
export type NewFamilySnapshot = {
  connectionId: string;
  scope: string;
  family: string;
  status: FamilyStatus;
  total: number | null;
  affected: number | null;
  readAt: number;
  unavailableReason: string | null;
  unavailableCode: string | null;
};

export function recordFamilySnapshot(db: Db, snapshot: NewFamilySnapshot): void {
  db.insert(familySnapshots)
    .values(snapshot)
    .onConflictDoUpdate({
      target: [familySnapshots.connectionId, familySnapshots.scope, familySnapshots.family],
      set: {
        status: snapshot.status,
        total: snapshot.total,
        affected: snapshot.affected,
        readAt: snapshot.readAt,
        unavailableReason: snapshot.unavailableReason,
        unavailableCode: snapshot.unavailableCode,
      },
    })
    .run();
}

export function listFamilySnapshots(db: Db, connectionId: string, scope: string): FamilySnapshotRow[] {
  return db
    .select()
    .from(familySnapshots)
    .where(and(eq(familySnapshots.connectionId, connectionId), eq(familySnapshots.scope, scope)))
    .all();
}
