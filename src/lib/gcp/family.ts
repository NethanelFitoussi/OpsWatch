import 'server-only';
import type { Insight, InsightSeverity } from '../monitoring/insights';
import type { FamilySummary } from '../monitoring/overview';
import type { MonitoringResult } from '../monitoring/result';
import { projectAlerts, type GcpIncident } from './alerts';
import type { GcpTarget } from './target';

/**
 * The one family a Google connection has: **incidents Google itself opened**.
 *
 * Not four families mirroring AWS's with Google service names in them. OpsWatch does not read Google's
 * metrics and decide a project is unwell — the project's own alerting policies do that, an operator
 * wrote them, and relaying what they opened is using the provider's evidence. A parallel set of
 * OpsWatch thresholds would be a second opinion beside the one the project already has, and the two
 * would disagree in front of somebody at three in the morning.
 *
 * What comes out is an ordinary `Insight`, so everything after this point — the lifecycle, the alert
 * cycle, incidents, the cross-cloud problems page — works on it without knowing it came from Google.
 */

/**
 * Google's severity, in OpsWatch's three.
 *
 * Google's alerting severities are `CRITICAL`, `ERROR` and `WARNING`, so three become two:
 *
 *   - `CRITICAL` and `ERROR` are both **critical**. Google's alerting is opt-in — somebody wrote the
 *     policy and chose `ERROR` to mean a failure — and showing it as a warning would rank it below
 *     what its author meant.
 *   - `WARNING`, and a policy with **no** severity, are **warning**. Not `info`: Google opened an
 *     incident, which is a statement that something is wrong, and `info` would read as a remark.
 *
 * Google's own word is kept in the problem's values either way, so nothing this mapping loses is
 * hidden from the operator — the page shows what Google said, not only what OpsWatch made of it.
 */
export function severityOf(googleSeverity: string | null): InsightSeverity {
  switch (googleSeverity) {
    case 'CRITICAL':
    case 'ERROR':
      return 'critical';
    default:
      return 'warning';
  }
}

/**
 * What identifies one incident across cycles.
 *
 * The policy **and** the resource, because either alone is wrong: two policies watching one instance
 * are two problems, and one policy firing on two instances is two problems. Length-prefixed for the
 * same reason the dedupe key is — a separator inside a policy name must not be able to make two
 * different incidents collide.
 *
 * Not Google's incident id, deliberately. An id changes when Google closes an incident and opens
 * another for the same cause, and a problem that started again is the same problem returning — which
 * is what the lifecycle's two-hour window exists to recognise.
 */
export const incidentSubjectId = (incident: GcpIncident): string =>
  [incident.policy, incident.resourceName ?? incident.resourceType ?? ''].map((part) => `${part.length}:${part}`).join('|');

/** What to show: the thing Google named, or the policy when it named nothing. */
const displayOf = (incident: GcpIncident): string => incident.resourceName ?? incident.resourceType ?? incident.policy;

export async function gcpAlertsFamily(
  target: GcpTarget,
  nowMs: number,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<MonitoringResult<FamilySummary>> {
  const answer = await projectAlerts({ target, nowMs, fetchImpl: deps.fetchImpl });
  if (!answer.ok) {
    // A refusal is a refusal, never an empty family: recorded as read-with-nothing-wrong it would be
    // a green mark for a look that did not happen.
    return { ok: false, reason: answer.reason === 'denied' ? 'denied' : 'error', code: answer.reason, action: 'gcp:alerts' };
  }

  const insights: Insight[] = answer.incidents.map((incident) => ({
    severity: severityOf(incident.severity),
    kind: 'gcp_incident_open',
    resource: displayOf(incident),
    subjectId: incidentSubjectId(incident),
    messageKey: 'Insights.messages.gcp_incident_open',
    values: {
      policy: incident.policy === '' ? '—' : incident.policy,
      resource: displayOf(incident),
      // Google's own word, carried through the mapping above so the operator sees what Google said.
      severity: incident.severity ?? 'UNSPECIFIED',
    },
    // The page about this project's alerts. Never a monitoring-rail path: the rail is ten AWS
    // services, and a Google incident linking into it would open a page about a service that cloud
    // does not have.
    href: `/accounts/${target.connectionId}/alerts`,
  }));

  return {
    ok: true,
    data: {
      insights,
      /*
       * **The estate here is the policies, not the instances.** What this family can tell you about
       * is what the project asked to be told about: with no enabled policy there is nothing to be
       * affected, and `0 of 0` says that far better than a count of virtual machines nobody is
       * watching would.
       */
      total: answer.policies.enabled,
      affected: insights.length,
      /*
       * Incidents are paged and the read stops at a cap. Past it, an incident that is still open can
       * be missing from what was read — and without this the cycle would treat the family as fully
       * read, see no sign of that problem, and **resolve it while Google still reports it open**.
       */
      truncated: answer.truncated,
    },
  };
}
