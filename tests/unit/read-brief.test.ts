import { describe, expect, it } from 'vitest';
import { briefSchema } from '@opswatch/contract';
import { BRIEF_PERIOD_MS, readBrief } from '@/lib/read/brief';
import { HEALTH_FAMILIES, readHealth } from '@/lib/read/health';
import { recordFamilySnapshot } from '@/lib/store/health';
import { applyTransitions } from '@/lib/store/problems';
import { createTestDb } from '../helpers/db';
import { detected } from '../helpers/detect';

const NOW = Date.UTC(2026, 8, 22, 8, 0, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };
const labels = {
  family: (family: string) => family,
  unavailable: (reason: string) => ({ messageKey: reason, message: reason }),
  change: (kind: string, values: Record<string, string | number>) => `${kind}:${values.subject}`,
};
const context = { nowMs: NOW, render: (key: string) => key, labels };

const readAll = (db: ReturnType<typeof createTestDb>) => {
  for (const family of HEALTH_FAMILIES) {
    recordFamilySnapshot(db, { ...env, family, status: 'healthy', total: 2, affected: 0, readAt: NOW, unavailableReason: null, unavailableCode: null });
  }
};

const open = (db: ReturnType<typeof createTestDb>, at: number, subjectId = 'prod/web', key = 'a') =>
  applyTransitions(db, env, [
    { type: 'open', key: key.repeat(32), at, problem: detected({ subjectId }), previousProblemId: null },
  ]);

describe('the morning brief', () => {
  it('is exactly what every client already parses', () => {
    const db = createTestDb();
    readAll(db);
    expect(briefSchema.safeParse(readBrief(db, env, context)).success).toBe(true);
  });

  it('carries the period it covers, which is what makes it a brief rather than a status', () => {
    const db = createTestDb();
    readAll(db);
    const brief = readBrief(db, env, context);
    expect(brief.period).toEqual({ from: NOW - BRIEF_PERIOD_MS, to: NOW });
  });

  it('reports what opened and what resolved in the period, in order', () => {
    const db = createTestDb();
    readAll(db);
    open(db, NOW - 3 * 3_600_000, 'prod/web', 'a');
    open(db, NOW - 3_600_000, 'prod/api', 'b');
    const brief = readBrief(db, env, context);
    expect(brief.changes.map((change) => change.text)).toEqual([
      'problem_opened:prod/api',
      'problem_opened:prod/web',
    ]);
  });

  it('leaves out what happened before the period began', () => {
    const db = createTestDb();
    readAll(db);
    open(db, NOW - BRIEF_PERIOD_MS - 60_000);
    expect(readBrief(db, env, context).changes).toEqual([]);
  });

  it('names the worst thing still open as where to start', () => {
    const db = createTestDb();
    readAll(db);
    open(db, NOW - 3_600_000);
    const brief = readBrief(db, env, context);
    expect(brief.mostImportant).not.toBeNull();
    expect(brief.mostImportant?.title).toBe('Insights.messages.ecs_cpu_high');
  });

  it('says there is nothing to start on rather than inventing something', () => {
    const db = createTestDb();
    readAll(db);
    expect(readBrief(db, env, context).mostImportant).toBeNull();
  });

  it('agrees with the Health page about whether production is healthy', () => {
    const db = createTestDb();
    readAll(db);
    open(db, NOW - 3_600_000);
    // Two pages disagreeing about the state of production would be worse than having neither.
    expect(readBrief(db, env, context).status).toBe(readHealth(db, env, context).status);
  });

  it('cannot say how production is when nothing has been read', () => {
    const db = createTestDb();
    expect(readBrief(db, env, context).status).toBe('unknown');
  });
});
