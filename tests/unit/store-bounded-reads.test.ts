import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every read of a growing table is bounded by something (§M).
 *
 * A self-hosted OpsWatch runs for years on somebody's own hardware. A `select … .all()` that was
 * instant on a week-old database is a page that stops loading on a two-year-old one, and nothing about
 * it looks wrong in between — which is why this is a guard rather than a habit.
 *
 * A read qualifies three ways:
 *
 *   1. **Limited** — it says `.limit(…)`.
 *   2. **Windowed** — it has a time bound in its `where`, so the rows it can return are the rows of a
 *      period rather than of a lifetime.
 *   3. **Bounded by nature** — the set cannot grow on its own. Those are listed below, each with the
 *      reason, because "it is small" is a claim and claims belong in writing.
 *
 * A read that is none of the three fails this until somebody decides which it is. That decision is the
 * point: the audit that produced the list below found the store already healthy, and its value is in
 * the forty-ninth read, not the first forty-eight.
 */

const STORE = join(__dirname, '../../src/lib/store');

/**
 * Reads whose row count is fixed by something other than time.
 *
 * Most are sets an operator creates by hand — they cannot grow while nobody is looking. The rest are
 * capped where they are written, which is stated with the cap.
 */
const BOUNDED_BY_NATURE: Record<string, string> = {
  // One row per thing the operator made, or per connection/region/zone they chose.
  'alerts.ts:listRules': 'alert rules of one environment, created by hand',
  'alerts.ts:ensureInstallRules': 'the install-rule offers of one environment, a fixed list',
  'alerts.ts:resolveAlertsExcept': 'open alerts of one environment; one per rule and subject',
  'collection.ts:listStacks': 'one row per region of one connection',
  'collection.ts:listManagedConnections': 'one row per connection',
  'collection.ts:listForwardedGroups': 'the log groups an operator switched on',
  'collector.ts:latestRunPerEnvironment': 'one row per environment of one job',
  'errors.ts:listLogSources': 'the log groups an operator switched on',
  'hosts.ts:listHostRows': 'one row per machine an operator enrolled',
  'hosts.ts:hostsByCloudInstance': 'one row per instance id asked about, and the ids come from one page of instances',
  'hosts.ts:countStaleHosts': 'one row per machine an operator enrolled',
  'hosts.ts:hostsInEnvironment': 'the machines placed in one account and region',
  'hosts.ts:freshHosts': 'the machines that reported inside the stale window',
  'logs-budget.ts:spendingConnections': 'one row per connection that reads logs',
  'logs-budget.ts:readUsageTotal': 'one row per connection, for one day',
  'notifications.ts:listDestinations': 'the webhooks an operator created',
  'repositories.ts:listIntegrations': 'one row per integration kind',
  'repositories.ts:listRepositories': 'the repositories an operator added',
  'repositories.ts:listMappings': 'one row per service an operator mapped',
  'saved-searches.ts:listSavedSearches': 'the searches one user saved',
  'slos.ts:listSloDefinitions': 'the objectives an operator defined',
  'synthetics.ts:listChecks': 'the checks an operator created',
  'incidents.ts:listOpenIncidents': 'open incidents of one environment; a closed one leaves the set',
  'incidents.ts:incidentProblemIds': 'the problems of one incident',
  'incidents.ts:suppressionsByService': 'one row per service with an open incident',
  'incidents.ts:listTimeline': 'the entries of one incident, each one an operator action or a transition',
  'health.ts:listFamilySnapshots': 'one row per family of one environment',
  'problems.ts:listEvidence': 'the evidence of one problem, replaced wholesale on each write',
  'problems.ts:listLiveProblems': 'the open problems of one environment — the detector must see all of them, and truncating would make it wrong',
  'problems.ts:applyTransitions': 'the transitions of one detect cycle',
  'problems.ts:countProblemsBySeverity': 'one row per severity: it counts, and a count has as many rows as there are severities',
  'audit.ts:countAudit': 'one row per action counted, and the actions are a closed list',
  'deployments.ts:countDeployments': 'one row per status counted, and the statuses are a closed list',
  'errors.ts:countOccurrences': 'one aggregate row, whatever the occurrences behind it',
  'deployment-commits.ts:listDeploymentCommits': 'capped at write by MAX_COMMITS = 10 in collector/deployment-code.ts',
  'deployment-commits.ts:previousDeploymentStart': 'the single deployment before this one, found by an ordered read',
  'collection.ts:recordsThisMinute': 'the stat rows of one minute',
  'history.ts:listHistorySubjects': 'one row per subject of one environment',
  'baselines.ts:listBaselines': 'one row per metric and subject of one environment',
};

type Read = { id: string; body: string; args: string };

function reads(): Read[] {
  const found: Read[] = [];
  for (const name of readdirSync(STORE).filter((file) => file.endsWith('.ts'))) {
    const text = readFileSync(join(STORE, name), 'utf8');
    for (const match of text.matchAll(/export function (\w+)\(([^)]*)\)[^{]*\{([\s\S]*?)\n\}/g)) {
      const [, fn, args, body] = match;
      if (!body.includes('.all()')) continue;
      found.push({ id: `${name}:${fn}`, body, args });
    }
  }
  return found;
}

/** A time bound in the query, or a window in the signature that can only be used as one. */
const WINDOWED = /\b(gte|lte|lt|gt|between)\s*\(/;
const WINDOW_ARG = /\b(sinceMs|notBeforeMs|fromMs|window|dayMs|nowMs|olderThanMs|atMs)\b/;

describe('§M — a read of a growing table cannot return a lifetime of rows', () => {
  const all = reads();

  it('reads enough of the store to be worth trusting', () => {
    // A regex that stopped matching would make every check below pass on an empty list.
    expect(all.length).toBeGreaterThan(40);
  });

  it('THE RULING: every unlimited read is windowed, or listed as bounded with its reason', () => {
    const unjustified = all
      .filter(({ body, args }) => !body.includes('.limit(') && !WINDOWED.test(body) && !WINDOW_ARG.test(args))
      .filter(({ id }) => BOUNDED_BY_NATURE[id] === undefined)
      .map(({ id }) => id);

    expect(unjustified).toEqual([]);
  });

  it('and the list holds no read that has since gone, so it cannot quietly excuse a new one', () => {
    const live = new Set(all.map((read) => read.id));
    expect(Object.keys(BOUNDED_BY_NATURE).filter((id) => !live.has(id))).toEqual([]);
  });

  it('every reason is a reason, not a word', () => {
    // "small" is not an argument. The entry has to say what fixes the size.
    for (const [id, reason] of Object.entries(BOUNDED_BY_NATURE)) {
      expect(reason.length, id).toBeGreaterThan(20);
    }
  });
});
