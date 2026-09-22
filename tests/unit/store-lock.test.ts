import { describe, expect, it } from 'vitest';
import {
  COLLECTOR_LOCK_ID, LOCK_HEARTBEAT_MS, LOCK_STALE_MS,
  claimCollectorLock, readCollectorLock, refreshCollectorLock, releaseCollectorLock,
} from '@/lib/store/collector';
import type { Db } from '@/lib/db/client';
import { collectorLock } from '@/lib/db/schema';
import { createTestDb } from '../helpers/db';

const AT = Date.UTC(2026, 8, 19, 9, 0, 0);

describe('the collector lock', () => {
  it('is won by exactly one of two claimers, and the loser runs nothing', () => {
    const db = createTestDb();
    const ran: string[] = [];
    for (const owner of ['a', 'b']) {
      if (claimCollectorLock(db, owner, AT)) ran.push(owner);
    }
    expect(ran).toEqual(['a']);
    expect(readCollectorLock(db)?.owner).toBe('a');
  });

  it('lets the holder re-claim and refresh its own lock', () => {
    const db = createTestDb();
    expect(claimCollectorLock(db, 'a', AT)).toBe(true);
    expect(claimCollectorLock(db, 'a', AT + 1000)).toBe(true);
    expect(refreshCollectorLock(db, 'a', AT + 2000)).toBe(true);
    expect(readCollectorLock(db)?.heartbeatAt).toBe(AT + 2000);
  });

  it('passes to another process only once the heartbeat is older than 90 seconds', () => {
    const db = createTestDb();
    claimCollectorLock(db, 'a', AT);
    expect(claimCollectorLock(db, 'b', AT + LOCK_STALE_MS)).toBe(false);
    expect(claimCollectorLock(db, 'b', AT + LOCK_STALE_MS + 1)).toBe(true);
    expect(readCollectorLock(db)?.owner).toBe('b');
  });

  it('refuses the refresh of a process that lost the lock while paused', () => {
    const db = createTestDb();
    claimCollectorLock(db, 'a', AT);
    claimCollectorLock(db, 'b', AT + LOCK_STALE_MS + 1);
    // 'a' wakes up believing it still holds the lock: the refresh must change no row.
    expect(refreshCollectorLock(db, 'a', AT + LOCK_STALE_MS + 2)).toBe(false);
    expect(readCollectorLock(db)?.owner).toBe('b');
  });

  it('releases only its own lock', () => {
    const db = createTestDb();
    claimCollectorLock(db, 'a', AT);
    releaseCollectorLock(db, 'b');
    expect(readCollectorLock(db)?.owner).toBe('a');
    releaseCollectorLock(db, 'a');
    expect(claimCollectorLock(db, 'b', AT + 1)).toBe(true);
  });
});

/**
 * Records which statement kinds a call issues. The five cases above all pass for a read-then-write claim, because
 * they run two claimers one after the other in one process and a synchronous driver makes that indistinguishable
 * from an atomic claim. §33.4 is not about the answer those cases check - it is about *how* the answer is reached,
 * so that is what this asserts directly.
 */
function recordingDb(db: Db): { db: Db; statements: string[] } {
  const statements: string[] = [];
  const watched = ['select', 'run', 'insert', 'update', 'delete', 'get', 'all'];
  return {
    db: new Proxy(db, {
      get(target, property, receiver) {
        if (typeof property === 'string' && watched.includes(property)) statements.push(property);
        return Reflect.get(target, property, receiver);
      },
    }) as Db,
    statements,
  };
}

describe('how the lock is claimed, not only what it answers', () => {
  it('claims in a single statement, reading nothing first (§33.4)', () => {
    // A read followed by a write loses the race: two processes both read a free lock and both take it. The
    // conditional update cannot, because the loser's update matches no row.
    const recorder = recordingDb(createTestDb());
    expect(claimCollectorLock(recorder.db, 'a', AT)).toBe(true);
    expect(recorder.statements).toEqual(['run']);
  });

  it('contends in a single statement too, so the loser is decided by the database', () => {
    const db = createTestDb();
    claimCollectorLock(db, 'a', AT);
    const recorder = recordingDb(db);
    expect(claimCollectorLock(recorder.db, 'b', AT + 1)).toBe(false);
    expect(recorder.statements).toEqual(['run']);
  });

  it('refreshes and releases in a single statement, each carrying its own owner', () => {
    const db = createTestDb();
    claimCollectorLock(db, 'a', AT);
    const refresh = recordingDb(db);
    expect(refreshCollectorLock(refresh.db, 'a', AT + 1000)).toBe(true);
    expect(refresh.statements).toEqual(['run']);
    const release = recordingDb(db);
    releaseCollectorLock(release.db, 'a');
    expect(release.statements).toEqual(['run']);
  });

  it('keeps the heartbeat well inside the stale window, so one slow cycle does not lose the lock', () => {
    expect(LOCK_HEARTBEAT_MS).toBeLessThan(LOCK_STALE_MS);
    // Three check-ins have to fit, or a single missed beat hands the lock to another process.
    expect(LOCK_HEARTBEAT_MS * 3).toBeLessThanOrEqual(LOCK_STALE_MS);
  });

  it('keeps every claimer on the one row', () => {
    const db = createTestDb();
    claimCollectorLock(db, 'a', AT);
    claimCollectorLock(db, 'a', AT + 1);
    expect(readCollectorLock(db)?.id).toBe(COLLECTOR_LOCK_ID);
    expect(db.select().from(collectorLock).all()).toHaveLength(1);
  });
});
