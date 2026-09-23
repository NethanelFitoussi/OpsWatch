import { describe, expect, it } from 'vitest';
import { incidentSummarySchema, incidentDetailSchema, INCIDENT_STATUSES } from '@opswatch/contract';
import { INCIDENT_LIMIT, getIncident, listIncidentSummaries, wireIncidentStatus } from '@/lib/read/incidents';
import { appendTimeline, dismissIncident, openIncident, setIncidentStatus } from '@/lib/store/incidents';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };
const labels = { title: (key: string, values: Record<string, string | number>) => `${key}:${JSON.stringify(values)}` };
const context = { nowMs: NOW, render: (key: string) => key };

const open = (db: ReturnType<typeof createTestDb>, over = {}) =>
  openIncident(db, {
    ...env,
    titleKey: 'Incidents.title.multiple_critical',
    values: { service: 'prod/web', problems: 2 },
    severity: 'critical',
    startedAt: NOW - 600_000,
    serviceIds: ['prod/web'],
    origin: 'auto',
    ...over,
  });

describe('the stored lifecycle into the contract’s', () => {
  it('THE RULING: every stored status maps to one the contract knows', () => {
    // A status that fell through would fail to parse on the wire, on the object a reader most needs.
    for (const stored of ['investigating', 'identified', 'monitoring', 'resolved'] as const) {
      expect(INCIDENT_STATUSES).toContain(wireIncidentStatus(stored));
    }
  });

  it('reads `monitoring` as mitigated and `identified` as still investigating', () => {
    // The contract has no word for "cause known, work continues", and inventing one would break v1.
    expect(wireIncidentStatus('monitoring')).toBe('mitigated');
    expect(wireIncidentStatus('identified')).toBe('investigating');
    expect(wireIncidentStatus('resolved')).toBe('resolved');
  });
});

describe('listing them', () => {
  it('answers the shape every client parses', () => {
    const db = createTestDb();
    open(db);
    const [summary] = listIncidentSummaries(db, env, labels);
    expect(() => incidentSummarySchema.parse(summary)).not.toThrow();
    expect(summary?.title).toContain('Incidents.title.multiple_critical');
    expect(summary?.affectedServices[0]).toMatchObject({ type: 'service', id: 'prod/web' });
  });

  it('THE RULING: a dismissed incident is not listed, because dismissal is a decision about noise', () => {
    const db = createTestDb();
    const incident = open(db);
    dismissIncident(db, incident.id, NOW, 'admin');
    expect(listIncidentSummaries(db, env, labels)).toEqual([]);
  });

  it('keeps environments apart', () => {
    const db = createTestDb();
    open(db);
    expect(listIncidentSummaries(db, { connectionId: 'c1', scope: 'eu-west-1' }, labels)).toEqual([]);
  });

  it('is bounded, because a list is a way in and not an archive', () => {
    expect(INCIDENT_LIMIT).toBeGreaterThan(0);
    expect(INCIDENT_LIMIT).toBeLessThanOrEqual(100);
  });
});

describe('one incident', () => {
  it('carries its timeline and notes apart, because a note is a person’s own words', () => {
    const db = createTestDb();
    const incident = open(db);
    appendTimeline(db, { incidentId: incident.id, at: NOW, kind: 'status_change', messageKey: 'Incidents.opened.multiple_critical', values: {} });
    appendTimeline(db, { incidentId: incident.id, at: NOW + 1000, kind: 'note', actorId: 'admin', note: 'Rolled back the deploy' });

    const found = getIncident(db, { ...env, id: incident.id }, labels, context);
    expect(found).not.toBeNull();
    if (found === null) return;

    expect(() => incidentDetailSchema.parse(found.detail)).not.toThrow();
    // A note is shown verbatim; a timeline entry is a key the client renders.
    expect(found.detail.notes).toEqual([{ at: NOW + 1000, text: 'Rolled back the deploy', author: 'admin' }]);
    expect(found.detail.timeline.some((entry) => entry.text.includes('Incidents.opened'))).toBe(true);
    expect(found.detail.timeline.some((entry) => entry.type === 'note')).toBe(false);
  });

  it('THE RULING: an id from another environment reads as absent, not as somebody else’s', () => {
    const db = createTestDb();
    const incident = open(db);
    expect(getIncident(db, { connectionId: 'c1', scope: 'eu-west-1', id: incident.id }, labels, context)).toBeNull();
  });

  it('offers dismissal only for an auto-created incident that is not already dismissed', () => {
    const db = createTestDb();
    const auto = open(db);
    expect(getIncident(db, { ...env, id: auto.id }, labels, context)?.detail.allowedActions).toEqual(['dismiss']);

    const manual = open(db, { origin: 'user' });
    expect(getIncident(db, { ...env, id: manual.id }, labels, context)?.detail.allowedActions).toEqual([]);
  });

  it('reports a resolved incident as resolved, with when', () => {
    const db = createTestDb();
    const incident = open(db);
    setIncidentStatus(db, incident.id, 'resolved', NOW, 'admin');
    const found = getIncident(db, { ...env, id: incident.id }, labels, context);
    expect(found?.detail.status).toBe('resolved');
    expect(found?.detail.resolvedAt).toBe(NOW);
  });
});
