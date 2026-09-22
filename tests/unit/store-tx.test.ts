import { describe, expect, it } from 'vitest';
import { MAX_ROWS_PER_TRANSACTION, inBatches } from '@/lib/store/tx';
import { problems } from '@/lib/db/schema';
import type { Db } from '@/lib/db/client';
import { createTestDb } from '../helpers/db';

const AT = Date.UTC(2026, 8, 19, 9, 0, 0);

const row = (index: number) => ({
  id: `p${index}`,
  key: String(index).padStart(32, '0'),
  connectionId: 'c1',
  scope: 'us-east-1',
  kind: 'ecs_cpu_high',
  subjectType: 'service' as const,
  subjectId: `s${index}`,
  subjectName: 'web',
  serviceId: null,
  source: 'aws',
  titleKey: 'Insights.messages.ecs_cpu_high',
  values: {},
  severity: 'warning' as const,
  score: 50,
  scoreTerms: {
    s: 0.55, b: null, t: 1, u: null, d: 0,
    weights: { s: 40, b: 20, t: 15, u: 15, d: 10 },
    availableWeight: 65, rescaled: true, floored: false, score: 50,
  },
  status: 'open' as const,
  href: '/c/c1/us-east-1',
  firstSeenAt: AT,
  lastSeenAt: AT,
  lastEvaluatedAt: AT,
});

const write = (tx: Db, batch: readonly ReturnType<typeof row>[]) => tx.insert(problems).values([...batch]).run();

describe('batched transactions', () => {
  it('writes every row and answers how many', async () => {
    const db = createTestDb();
    const rows = Array.from({ length: 5 }, (_, i) => row(i));
    expect(await inBatches(db, rows, write)).toBe(5);
    expect(db.select().from(problems).all()).toHaveLength(5);
  });

  it('writes nothing, and opens no transaction, for an empty list', async () => {
    const db = createTestDb();
    expect(await inBatches(db, [], write)).toBe(0);
    expect(db.select().from(problems).all()).toHaveLength(0);
  });

  it('splits at the cap and yields between batches, so the event loop keeps serving', async () => {
    const db = createTestDb();
    const rows = Array.from({ length: MAX_ROWS_PER_TRANSACTION + 1 }, (_, i) => row(i));
    const batches: number[] = [];
    // A timer set before the write runs only if the write yields; a single long transaction would starve it.
    let served = false;
    setImmediate(() => {
      served = true;
    });
    const written = await inBatches(db, rows, (tx, batch) => {
      batches.push(batch.length);
      write(tx, batch);
    });
    expect(batches).toEqual([MAX_ROWS_PER_TRANSACTION, 1]);
    expect(written).toBe(MAX_ROWS_PER_TRANSACTION + 1);
    expect(served).toBe(true);
    expect(db.select().from(problems).all()).toHaveLength(MAX_ROWS_PER_TRANSACTION + 1);
  });

  it('rolls back only the batch that threw, keeping the batches already committed', async () => {
    const db = createTestDb();
    const rows = Array.from({ length: MAX_ROWS_PER_TRANSACTION + 2 }, (_, i) => row(i));
    await expect(
      inBatches(db, rows, (tx, batch) => {
        write(tx, batch);
        // The second batch fails after writing, so its rows must not survive while the first batch's do.
        if (batch.length < MAX_ROWS_PER_TRANSACTION) throw new Error('collection failed');
      }),
    ).rejects.toThrow('collection failed');
    expect(db.select().from(problems).all()).toHaveLength(MAX_ROWS_PER_TRANSACTION);
  });
});
