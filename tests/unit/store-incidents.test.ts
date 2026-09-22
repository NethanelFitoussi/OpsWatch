import { describe, expect, it } from 'vitest';
import {
  appendTimeline,
  attachProblem,
  dismissIncident,
  findIncident,
  incidentProblemIds,
  listTimeline,
  openIncident,
  setIncidentStatus,
  type NewIncident,
} from '@/lib/store/incidents';
import { findProblemById, insertProblem } from '@/lib/store/problems';
import { incidents } from '@/lib/db/schema';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

const AT = Date.UTC(2026, 8, 19, 9, 0, 0);

const newIncident = (over: Partial<NewIncident> = {}): NewIncident => ({
  connectionId: 'c1',
  scope: 'us-east-1',
  titleKey: 'Incidents.titles.service_degraded',
  values: { service: 'web' },
  severity: 'critical',
  startedAt: AT,
  serviceIds: ['prod/web'],
  origin: 'auto',
  ...over,
});

describe('the incident store', () => {
  it('opens investigating, with the severity it was given and nothing resolved yet', () => {
    const db = createTestDb();
    const incident = openIncident(db, newIncident());
    expect({ status: incident.status, severity: incident.severity, resolvedAt: incident.resolvedAt }).toEqual({
      status: 'investigating',
      severity: 'critical',
      resolvedAt: null,
    });
    expect(incident.serviceIds).toEqual(['prod/web']);
    expect(findIncident(db, incident.id)?.id).toBe(incident.id);
    expect(findIncident(db, 'no-such-incident')).toBeNull();
  });

  it('attaches a problem through the problem row, because a problem belongs to at most one incident', () => {
    const db = createTestDb();
    const incident = openIncident(db, newIncident());
    const problem = insertProblem(db, newProblem());
    attachProblem(db, incident.id, problem.id);
    // There is no join table: §4.8's problemIds[] is read back through problems.incident_id.
    expect(findProblemById(db, problem.id)?.incidentId).toBe(incident.id);
    expect(incidentProblemIds(db, incident.id)).toEqual([problem.id]);
    // The attachment is itself part of the story the timeline tells.
    expect(listTimeline(db, incident.id).map((row) => row.kind)).toEqual(['event']);
  });

  it('appends a status change and stamps resolvedAt only when it resolves', () => {
    const db = createTestDb();
    const incident = openIncident(db, newIncident());
    const identified = setIncidentStatus(db, incident.id, 'identified', AT + 1000, 'admin-1');
    expect({ status: identified.status, resolvedAt: identified.resolvedAt }).toEqual({
      status: 'identified',
      resolvedAt: null,
    });
    const resolved = setIncidentStatus(db, incident.id, 'resolved', AT + 2000, 'admin-1');
    expect({ status: resolved.status, resolvedAt: resolved.resolvedAt }).toEqual({
      status: 'resolved',
      resolvedAt: AT + 2000,
    });
    expect(listTimeline(db, incident.id).map((row) => row.kind)).toEqual(['status_change', 'status_change']);
  });

  it('returns the timeline oldest last, all of it timestamped', () => {
    const db = createTestDb();
    const incident = openIncident(db, newIncident());
    appendTimeline(db, { incidentId: incident.id, at: AT + 3000, kind: 'note', actorId: 'admin-1', note: 'rolled back' });
    appendTimeline(db, { incidentId: incident.id, at: AT + 1000, kind: 'event', eventId: 'e1' });
    setIncidentStatus(db, incident.id, 'monitoring', AT + 2000, null);
    // §16: "all timestamped, newest last" — the order is the incident's own clock, not the write order.
    expect(listTimeline(db, incident.id).map((row) => row.at)).toEqual([AT + 1000, AT + 2000, AT + 3000]);
    expect(listTimeline(db, incident.id).every((row) => Number.isFinite(row.at))).toBe(true);
  });

  it('records a dismissal without resolving the incident', () => {
    const db = createTestDb();
    const incident = openIncident(db, newIncident());
    const dismissed = dismissIncident(db, incident.id, AT + 5000, 'admin-1');
    expect({ dismissedAt: dismissed.dismissedAt, status: dismissed.status, resolvedAt: dismissed.resolvedAt }).toEqual({
      dismissedAt: AT + 5000,
      status: 'investigating',
      resolvedAt: null,
    });
  });

  it('deletes the timeline with the incident', () => {
    const db = createTestDb();
    const incident = openIncident(db, newIncident());
    appendTimeline(db, { incidentId: incident.id, at: AT, kind: 'note', note: 'a note' });
    db.delete(incidents).run();
    expect(listTimeline(db, incident.id)).toHaveLength(0);
  });
});
