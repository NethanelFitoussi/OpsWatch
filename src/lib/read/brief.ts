import 'server-only';
import type { Brief } from '@opswatch/contract';
import type { Db } from '../db/client';
import { changesFrom, overallStatus, readHealth, type HealthContext } from './health';
import { countBySeverity, topProblems } from './problems';

/**
 * The Morning brief (D1's `brief`): health over a **period** rather than at an instant.
 *
 * That is the whole difference from Health, and it is why this carries `period` and `changes`. The question
 * it answers is "what happened since I last looked", and it answers it from the events spine the collector
 * writes — not by reading AWS a second time.
 */

/** How far back the brief looks by default: since yesterday, which is what "morning" means. */
export const BRIEF_PERIOD_MS = 24 * 60 * 60_000;

export function readBrief(
  db: Db,
  query: { connectionId: string; scope: string; periodMs?: number },
  context: HealthContext,
): Brief {
  const periodMs = query.periodMs ?? BRIEF_PERIOD_MS;
  const from = context.nowMs - periodMs;
  const counts = countBySeverity(db, query);
  const health = readHealth(db, query, context);

  return {
    generatedAt: context.nowMs,
    period: { from, to: context.nowMs },
    // The same verdict Health reaches, from the same families: a brief that disagreed with the Health page
    // about whether production is healthy would be worse than having neither.
    status: overallStatus(health.families, counts),
    counts: health.counts,
    changes: changesFrom(db, { ...query, sinceMs: from, untilMs: context.nowMs }, context.labels),
    // The worst thing open right now, which is what a reader wants first after a night away.
    mostImportant: topProblems(db, query, context)[0] ?? null,
  };
}
