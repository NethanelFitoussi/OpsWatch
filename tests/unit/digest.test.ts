import { describe, expect, it, vi } from 'vitest';
import { WEEK_MS, digestCounts, digestIsDue } from '@/lib/notify/digest';
import { createTestDb } from '../helpers/db';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: SECRET, OPSWATCH_PUBLIC_URL: 'https://ops.example.com' }) }));

const { runDigestJob } = await import('@/lib/collector/digest-job');
const { readDigestSettings, writeDigestSettings } = await import('@/lib/store/digest-settings');
const { createDestination, listDeliveries, setDestinationEnabled } = await import('@/lib/store/notifications');
const { createConnection } = await import('@/lib/connections/repository');
const { recordFamilySnapshot } = await import('@/lib/store/health');

/** A Monday at 08:00 UTC — the default day and hour. */
const MONDAY_8 = Date.UTC(2026, 8, 21, 8, 30, 0);
const schedule = (over: Partial<Parameters<typeof digestIsDue>[0]> = {}) => ({
  enabled: true,
  dayOfWeek: 1,
  hourUtc: 8,
  lastSentAt: null as number | null,
  ...over,
});

describe('REP-7 — when a weekly summary is due', () => {
  it('THE RULING: never, until somebody switches it on', () => {
    // §15: nothing leaves the instance unless an operator asked for it, and nobody is waiting for a
    // summary they did not ask for.
    expect(digestIsDue(schedule({ enabled: false }), MONDAY_8)).toBe(false);
  });

  it('sends on the chosen day and hour, in UTC', () => {
    expect(digestIsDue(schedule(), MONDAY_8)).toBe(true);
    expect(digestIsDue(schedule(), MONDAY_8 + 60 * 60_000)).toBe(false);
    expect(digestIsDue(schedule(), MONDAY_8 + 24 * 60 * 60_000)).toBe(false);
    expect(digestIsDue(schedule({ dayOfWeek: 2 }), MONDAY_8)).toBe(false);
    expect(digestIsDue(schedule({ hourUtc: 9 }), MONDAY_8)).toBe(false);
  });

  it('THE RULING: once a week, not once an hour', () => {
    // The job runs hourly. Without this, every cycle inside the chosen hour would send another summary.
    expect(digestIsDue(schedule({ lastSentAt: MONDAY_8 - 60_000 }), MONDAY_8)).toBe(false);
    expect(digestIsDue(schedule({ lastSentAt: MONDAY_8 - WEEK_MS }), MONDAY_8)).toBe(true);
  });

  it('sends the first one it can, because a first run has never sent any', () => {
    expect(digestIsDue(schedule({ lastSentAt: null }), MONDAY_8)).toBe(true);
  });
});

describe('what a summary says', () => {
  const report = {
    sections: [
      { id: 'problems', figures: [{ id: 'opened', value: 4 }, { id: 'resolved', value: 1 }], unavailable: null },
      { id: 'errors', figures: [{ id: 'occurrences', value: 12 }], unavailable: null },
    ],
  };

  it('takes its counts out of the report, so the two cannot disagree', () => {
    expect(digestCounts(report)).toEqual({ problemsOpened: 4, problemsResolved: 1, errorOccurrences: 12 });
  });

  it('THE RULING: a section the report could not answer is null, never zero', () => {
    const unmeasured = { sections: [{ id: 'problems', figures: [], unavailable: 'not_measured' }] };
    expect(digestCounts(unmeasured)).toEqual({ problemsOpened: null, problemsResolved: null, errorOccurrences: null });
  });
});

describe('REP-7 — the job', () => {
  const NOW = MONDAY_8;

  const withEnvironment = () => {
    const db = createTestDb();
    const connection = createConnection(db, { name: 'prod', method: 'role', awsAccountId: '123456789012', regions: ['us-east-1'] });
    // "Read at least once": a summary of an environment nobody has looked at is a page of zeroes.
    recordFamilySnapshot(db, {
      connectionId: connection.id,
      scope: 'us-east-1',
      family: 'ecs',
      status: 'healthy',
      total: 1,
      affected: 0,
      readAt: NOW,
      unavailableReason: null,
      unavailableCode: null,
    });
    return { db, connectionId: connection.id };
  };

  const enable = (db: ReturnType<typeof createTestDb>) => writeDigestSettings(db, { enabled: true, dayOfWeek: 1, hourUtc: 8 }, NOW);

  it('THE RULING: with no destination, nothing is queued and nothing leaves the instance', async () => {
    const { db } = withEnvironment();
    enable(db);
    expect(await runDigestJob({ db, nowMs: NOW })).toEqual({ covered: 0, total: 0 });
    // And the week is not marked as sent, so the summary still goes out once somewhere to send it exists.
    expect(readDigestSettings(db).lastSentAt).toBeNull();
  });

  it('THE RULING: with the switch off, nothing is queued even though a destination exists', async () => {
    const { db } = withEnvironment();
    const { destination } = createDestination(db, { name: 'ops', url: 'https://hooks.example.com/x' }, SECRET, NOW);
    expect(await runDigestJob({ db, nowMs: NOW })).toEqual({ covered: 0, total: 0 });
    expect(listDeliveries(db, destination.id, 10)).toEqual([]);
  });

  it('skips a destination somebody switched off', async () => {
    const { db } = withEnvironment();
    enable(db);
    const { destination } = createDestination(db, { name: 'ops', url: 'https://hooks.example.com/x' }, SECRET, NOW);
    setDestinationEnabled(db, destination.id, false);
    expect(await runDigestJob({ db, nowMs: NOW })).toEqual({ covered: 0, total: 0 });
  });

  it('queues one summary per environment per enabled destination', async () => {
    const { db, connectionId } = withEnvironment();
    enable(db);
    const { destination } = createDestination(db, { name: 'ops', url: 'https://hooks.example.com/x' }, SECRET, NOW);

    expect(await runDigestJob({ db, nowMs: NOW })).toMatchObject({ covered: 1 });
    const [delivery] = listDeliveries(db, destination.id, 10);
    expect(delivery.payload).toMatchObject({
      kind: 'report.weekly',
      environment: `${connectionId}:us-east-1`,
      url: `https://ops.example.com/c/${connectionId}/us-east-1/overview/report`,
    });
  });

  it('THE RULING: the payload carries counts and a link, never a log line', async () => {
    const { db } = withEnvironment();
    enable(db);
    const { destination } = createDestination(db, { name: 'ops', url: 'https://hooks.example.com/x' }, SECRET, NOW);
    await runDigestJob({ db, nowMs: NOW });

    const payload = listDeliveries(db, destination.id, 10)[0].payload as Record<string, unknown>;
    // An error group's sample message is whatever some process wrote, including whatever an attacker made
    // it write. The summary is numbers, so there is nowhere for one to travel.
    expect(Object.keys(payload).sort()).toEqual(['environment', 'generatedAt', 'id', 'kind', 'period', 'summary', 'url']);
    expect(Object.keys(payload.summary as object).sort()).toEqual(['errorOccurrences', 'problemsOpened', 'problemsResolved']);
    expect(JSON.stringify(payload)).not.toContain(SECRET);
  });

  it('THE RULING: an environment nobody has read is not summarised as a quiet week', async () => {
    const db = createTestDb();
    createConnection(db, { name: 'prod', method: 'role', awsAccountId: '123456789012', regions: ['us-east-1'] });
    enable(db);
    const { destination } = createDestination(db, { name: 'ops', url: 'https://hooks.example.com/x' }, SECRET, NOW);
    // A report over an environment nothing has ever read is all zeroes, and a zero nobody measured is
    // exactly what this product refuses to send.
    expect(await runDigestJob({ db, nowMs: NOW })).toMatchObject({ covered: 0 });
    expect(listDeliveries(db, destination.id, 10)).toEqual([]);
  });

  it('sends once and then not again for a week', async () => {
    const { db } = withEnvironment();
    enable(db);
    const { destination } = createDestination(db, { name: 'ops', url: 'https://hooks.example.com/x' }, SECRET, NOW);

    await runDigestJob({ db, nowMs: NOW });
    await runDigestJob({ db, nowMs: NOW + 60_000 });
    await runDigestJob({ db, nowMs: NOW + 30 * 60_000 });
    expect(listDeliveries(db, destination.id, 10)).toHaveLength(1);

    await runDigestJob({ db, nowMs: NOW + WEEK_MS });
    expect(listDeliveries(db, destination.id, 10)).toHaveLength(2);
  });

  it('keeps the week when the schedule is edited, so a small change is not a second summary', () => {
    const { db } = withEnvironment();
    writeDigestSettings(db, { enabled: true, dayOfWeek: 1, hourUtc: 8 }, NOW);
    const sent = readDigestSettings(db);
    expect(sent.lastSentAt).toBeNull();
    writeDigestSettings(db, { enabled: true, dayOfWeek: 3, hourUtc: 9 }, NOW + 1000);
    expect(readDigestSettings(db)).toMatchObject({ dayOfWeek: 3, hourUtc: 9, lastSentAt: null });
  });
});
