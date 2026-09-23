import 'server-only';
import type { Db } from '../db/client';
import type { Candidate } from '../detect/alert';
import { FAST_BURN, SLOW_BURN, burnAlert, evaluateSlo } from '../detect/slo';
import { readHistorySettings } from '../history/settings';
import { bucketsFor, expectedBuckets } from '../read/slos';
import { listSloDefinitions } from '../store/slos';

/**
 * Turning a spent error budget into something that alerts (§19, SLO-2).
 *
 * The arithmetic has been here since the SLO work started: `burnAlert` tells 14.4× over an hour from 6×
 * over six hours. Nothing acted on it, so an objective could be burning through a month's budget in a
 * morning and the only way to find out was to open the page. This is the part that tells someone.
 *
 * **Both windows are evaluated, and the fast one wins.** §19 asks for two because one is not enough: a
 * single short window alerts on every blip, and a single long one notices a total outage hours late. The
 * fast burn is the emergency and the slow burn is the warning, so they are different severities and an
 * environment burning fast is not also told about the slow burn it obviously has.
 *
 * An objective without enough history burns at no measurable rate, and says nothing. A rate OpsWatch could
 * not measure is not a rate of zero (§2.4).
 */

export type BurnContext = { connectionId: string; scope: string };

/** What each burn is called, and how loudly. A slow burn gives time to act; a fast one does not. */
const BURN = {
  // The title key is written out rather than built from the kind, so a catalogue check can find it by
  // reading the source — a key assembled at runtime is one nothing notices is missing until it is on screen.
  fast: { kind: 'slo_burn_fast', titleKey: 'Insights.messages.slo_burn_fast', severity: 'critical' as const, window: FAST_BURN },
  slow: { kind: 'slo_burn_slow', titleKey: 'Insights.messages.slo_burn_slow', severity: 'warning' as const, window: SLOW_BURN },
};

export function sloBurnCandidates(db: Db, context: BurnContext, nowMs: number): Candidate[] {
  // With history off there are no rollups, so there is nothing to burn through and nothing to say.
  if (!readHistorySettings(db).enabled) return [];

  const candidates: Candidate[] = [];
  for (const definition of listSloDefinitions(db, context.connectionId, context.scope)) {
    if (!definition.enabled) continue;

    for (const speed of ['fast', 'slow'] as const) {
      const { kind, titleKey, severity, window } = BURN[speed];
      const range = { from: nowMs - window.windowMs, to: nowMs };
      const result = evaluateSlo(bucketsFor(db, definition, range), definition.objective, expectedBuckets(range));
      if (burnAlert(result.burnRate, window.windowMs) !== speed) continue;

      candidates.push({
        // One alert per objective and speed. The definition's id rather than its name, so renaming an
        // objective does not read as a new problem starting.
        subjectKey: `slo:${definition.id}:${speed}`,
        kind,
        severity,
        problemId: null,
        titleKey,
        values: {
          name: definition.name,
          rate: Math.round((result.burnRate ?? 0) * 10) / 10,
          // Stated in the alert, because "burning fast" means nothing without the window it was measured over.
          hours: Math.round(window.windowMs / 3_600_000),
        },
      });
      // The fast burn is the emergency; saying the slow one too would be two messages about one thing.
      break;
    }
  }
  return candidates;
}
