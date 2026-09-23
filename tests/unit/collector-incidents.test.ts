import { describe, expect, it } from 'vitest';
import { runIncidentCycle, toCandidate } from '@/lib/collector/incidents';
import { dismissIncident, incidentProblemIds, listIncidents, listOpenIncidents, listTimeline } from '@/lib/store/incidents';
import { insertProblem } from '@/lib/store/problems';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const MINUTE = 60_000;
const env = { connectionId: 'c1', scope: 'us-east-1' };

const terms = (u: number | null) => ({
  s: 1, b: 0.5, t: 1, u, d: 0,
  weights: { s: 40, b: 20, t: 15, u: 15, d: 10 },
  availableWeight: 100, rescaled: false, floored: false, score: 82,
});

const seed = (db: ReturnType<typeof createTestDb>, id: string, over: Record<string, unknown> = {}) =>
  insertProblem(db, newProblem({
    key: id.padEnd(32, 'x'),
    severity: 'critical',
    firstSeenAt: NOW - MINUTE,
    lastSeenAt: NOW,
    lastEvaluatedAt: NOW,
    scoreTerms: terms(1),
    ...over,
  }));

const live = (db: ReturnType<typeof createTestDb>, ...rows: ReturnType<typeof seed>[]) => rows;

describe('the projection the rule reads', () => {
  it('carries §33.7’s user-facing term, including when it was not measured', () => {
    const db = createTestDb();
    expect(toCandidate(seed(db, 'a', { scoreTerms: terms(null) })).userFacing).toBeNull();
    expect(toCandidate(seed(db, 'b', { scoreTerms: terms(1) })).userFacing).toBe(1);
  });
});

describe('§16 — a cycle that raises an incident', () => {
  it('opens one, links the problems and records why', () => {
    const db = createTestDb();
    const rows = live(db, seed(db, 'a'), seed(db, 'b'));

    expect(runIncidentCycle(db, env, rows, NOW)).toEqual({ opened: 1 });
    const [incident] = listOpenIncidents(db, env.connectionId, env.scope);
    expect(incident).toMatchObject({ origin: 'auto', severity: 'critical', status: 'investigating' });
    expect(incidentProblemIds(db, incident.id).sort()).toEqual(rows.map((row) => row.id).sort());

    // A reader asking "why is this an incident?" should not have to reconstruct the rule. The entry sits
    // last, because the attachments are dated by the problems they attach and those started earlier — the
    // timeline reads in the order things happened, not in the order rows were written.
    const timeline = listTimeline(db, incident.id);
    expect(timeline.map((entry) => entry.messageKey)).toContain('Incidents.opened.multiple_critical');
    expect(timeline.at(-1)?.messageKey).toBe('Incidents.opened.multiple_critical');
    expect(timeline.map((entry) => entry.at)).toEqual([...timeline.map((entry) => entry.at)].sort((a, b) => a - b));
  });

  it('THE RULING: a second cycle does not open a second incident for the same service', () => {
    const db = createTestDb();
    const rows = live(db, seed(db, 'a'), seed(db, 'b'));
    runIncidentCycle(db, env, rows, NOW);
    expect(runIncidentCycle(db, env, rows, NOW + 5 * MINUTE)).toEqual({ opened: 0 });
    expect(listIncidents(db, env.connectionId, env.scope, 10)).toHaveLength(1);
  });

  it('THE RULING: dismissing one keeps it quiet for two hours, then it may return', () => {
    const db = createTestDb();
    const rows = live(db, seed(db, 'a'), seed(db, 'b'));
    runIncidentCycle(db, env, rows, NOW);
    const [incident] = listOpenIncidents(db, env.connectionId, env.scope);
    dismissIncident(db, incident.id, NOW, 'admin');

    // Dismissal has to mean something, or it is a button that does nothing.
    expect(runIncidentCycle(db, env, rows, NOW + 60 * MINUTE)).toEqual({ opened: 0 });
    expect(runIncidentCycle(db, env, rows, NOW + 3 * 60 * MINUTE)).toEqual({ opened: 1 });
  });

  it('opens nothing on a quiet environment', () => {
    const db = createTestDb();
    expect(runIncidentCycle(db, env, [], NOW)).toEqual({ opened: 0 });
    expect(listIncidents(db, env.connectionId, env.scope, 10)).toEqual([]);
  });

  it('does not raise one for a sustained problem nobody measured as user-facing', () => {
    const db = createTestDb();
    const rows = live(db, seed(db, 'a', { firstSeenAt: NOW - 30 * MINUTE, scoreTerms: terms(null) }));
    expect(runIncidentCycle(db, env, rows, NOW)).toEqual({ opened: 0 });
  });

  it('raises one for a sustained problem on a service measured as user-facing', () => {
    const db = createTestDb();
    const rows = live(db, seed(db, 'a', { firstSeenAt: NOW - 30 * MINUTE, scoreTerms: terms(1) }));
    expect(runIncidentCycle(db, env, rows, NOW)).toEqual({ opened: 1 });
  });
});
