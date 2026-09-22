import { checkupSchema, type Checkup } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { env } from '@/lib/env';
import { readCheckup } from '@/lib/read/checkup';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/v1/checkup` (Stage 3 §4).
 *
 * A bounded object, not a page: a catalogue that ran is a complete answer, and half of one would be a
 * coverage claim nobody could check. It reads only what is already stored, so calling it costs nothing.
 */
export const GET = apiRoute({
  handler: ({ db, url }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);

    const checkup = readCheckup(
      db,
      { connectionId: environment.connectionId, scope: environment.scope },
      { nowMs: Date.now(), logsBudgetGbPerDay: env().OPSWATCH_LOGS_BUDGET_GB_PER_DAY },
    );

    const body: Checkup = {
      generatedAt: Date.now(),
      findings: checkup.findings.map((finding) => ({
        id: finding.id,
        severity: finding.severity,
        subject: finding.subject,
        values: finding.values,
      })),
      coverage: checkup.coverage,
      notRun: checkup.notRun.map((outcome) => ({ id: outcome.id, reason: outcome.reason, values: outcome.values })),
    };
    return apiJson(checkupSchema, body);
  },
});
