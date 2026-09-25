import 'server-only';
import { listConnections } from '../connections/repository';
import { randomId } from '../crypto';
import type { Db } from '../db/client';
import { digestCounts, digestIsDue } from '../notify/digest';
import { reportUrl } from '../notify/deliver';
import type { WeeklyReportPayload } from '../notify/payload';
import { hasBeenRead } from '../read/health';
import { readReport } from '../read/reports';
import { markDigestSent, readDigestSettings } from '../store/digest-settings';
import { destinationsFor, listDestinations, queueDelivery } from '../store/notifications';
import type { JobOutcome } from './runner';

/**
 * The weekly summary (REP-7).
 *
 * It queues; the notify job sends. That is deliberate: the retry policy, the signing and the failure
 * record already exist for alerts, and a second delivery path would be a second place for them to drift.
 *
 * **Four gates, and all four must open.** With any of them shut this job costs nothing and sends nothing,
 * which is why it is on from a fresh install:
 *
 *   1. an operator switched the weekly summary on — off is the default and stays it;
 *   2. at least one destination exists **and is enabled** — §15: nothing leaves the instance unless
 *      somebody configured somewhere for it to go;
 *   3. it is the chosen day and hour, and a week has passed since the last one;
 *   4. the environment has actually been read. A summary of an environment OpsWatch has never looked at
 *      would be a page of zeroes presented as a quiet week.
 *
 * `lastSentAt` is recorded once for the whole run rather than per environment, so a second environment
 * cannot re-open the week for the first.
 */
export async function runDigestJob({ db, nowMs }: { db: Db; nowMs: number }): Promise<JobOutcome> {
  const settings = readDigestSettings(db);
  if (!digestIsDue(settings, nowMs)) return { covered: 0, total: 0 };

  // Nowhere at all to send is still the early exit; which of them each environment reaches is decided
  // per environment below.
  if (listDestinations(db).filter((destination) => destination.enabled).length === 0) return { covered: 0, total: 0 };

  const environments = listConnections(db).flatMap((connection) =>
    connection.regions.map((region) => ({ connectionId: connection.id, scope: region })),
  );

  let queued = 0;
  // What could have been sent, counted the same way it is sent: per environment, over the destinations
  // that environment actually reaches.
  let possible = 0;
  for (const environment of environments) {
    // Nothing has been read here, so there is nothing to summarise. A report over an unread environment is
    // all zeroes, and a zero nobody measured is the one thing this product refuses to send.
    if (!hasBeenRead(db, { connectionId: environment.connectionId, scope: environment.scope })) continue;

    const report = readReport(db, { ...environment, section: 'overview', period: '7d' }, { nowMs });
    const payload: WeeklyReportPayload = {
      id: randomId(),
      kind: 'report.weekly',
      environment: `${environment.connectionId}:${environment.scope}`,
      period: { from: report.period.from, to: report.period.to },
      generatedAt: report.generatedAt,
      // Counts, never the report's rows: an error group's sample message is a raw log line.
      summary: digestCounts(report),
      url: reportUrl(environment.connectionId, environment.scope),
    };

    // This environment's destinations. The weekly summary names the account it is about, so sending it
    // to an endpoint that belongs to a different client would be that client's data, not a preference.
    const theirs = destinationsFor(db, environment.connectionId).filter((one) => one.enabled);
    possible += theirs.length;
    for (const destination of theirs) {
      queueDelivery(db, { destinationId: destination.id, alertId: payload.id, payload, nowMs });
      queued += 1;
    }
  }

  // Recorded whatever was queued, including nothing: an installation with a connection nobody has read
  // must not retry every cycle for the rest of the chosen hour.
  markDigestSent(db, nowMs);
  return { covered: queued, total: possible };
}
