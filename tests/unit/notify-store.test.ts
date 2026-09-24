import { describe, expect, it, vi } from 'vitest';
import { runNotifyJob } from '@/lib/collector/notify-job';
import { MAX_ATTEMPTS } from '@/lib/notify/deliver';
import { verify, type AlertPayload } from '@/lib/notify/payload';
import {
  createDestination,
  deleteDestination,
  dueDeliveries,
  listDeliveries,
  listDestinations,
  queueDelivery,
  secretOf,
  setDestinationEnabled,
} from '@/lib/store/notifications';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

const payload = (): AlertPayload => ({
  id: 'p1',
  alertId: 'a1',
  kind: 'alert.fired',
  severity: 'critical',
  title: 'x',
  subject: 's',
  environment: 'c1:eu-west-1',
  firedAt: NOW,
  url: null,
});

describe('a destination', () => {
  it('THE RULING: the signing secret is never on a view a page could render', () => {
    const db = createTestDb();
    const { destination, signingSecret } = createDestination(db, { name: 'Ops', url: 'https://example.com/h' }, SECRET, NOW);
    expect(signingSecret.length).toBeGreaterThan(20);
    // The view type has no such field, and neither does the object at runtime.
    expect(JSON.stringify(destination)).not.toContain(signingSecret);
    expect(JSON.stringify(listDestinations(db))).not.toContain(signingSecret);
    expect(Object.keys(destination)).not.toContain('secretCiphertext');
  });

  it('is readable only through the one named accessor, and comes back as it went in', () => {
    const db = createTestDb();
    const { destination, signingSecret } = createDestination(db, { name: 'Ops', url: 'https://example.com/h' }, SECRET, NOW);
    expect(secretOf(db, destination.id, SECRET)).toBe(signingSecret);
  });

  it('gives every destination its own secret', () => {
    const db = createTestDb();
    const a = createDestination(db, { name: 'A', url: 'https://a.example/h' }, SECRET, NOW);
    const b = createDestination(db, { name: 'B', url: 'https://b.example/h' }, SECRET, NOW);
    expect(a.signingSecret).not.toBe(b.signingSecret);
  });
});

describe('the notify job', () => {
  const sending = (status: number) => vi.fn(async () => new Response('', { status })) as unknown as typeof fetch;

  it('THE RULING: with no destination, nothing is queued and nothing is sent', async () => {
    const db = createTestDb();
    const send = sending(200);
    const outcome = await runNotifyJob(db, SECRET, NOW, { fetch: send });
    expect(outcome.total).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a queued delivery, signed with that destination’s own secret', async () => {
    const db = createTestDb();
    const { destination, signingSecret } = createDestination(db, { name: 'Ops', url: 'https://example.com/h' }, SECRET, NOW);
    queueDelivery(db, { destinationId: destination.id, alertId: 'a1', payload: payload(), nowMs: NOW });

    const send = vi.fn(async () => new Response('', { status: 200 }));
    await runNotifyJob(db, SECRET, NOW, { fetch: send as unknown as typeof fetch });

    const [, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(verify(NOW, init.body as string, signingSecret, headers['x-opswatch-signature'])).toBe(true);
    expect(listDeliveries(db, destination.id, 10)[0].status).toBe('ok');
  });

  it('THE RULING: a failure is retried on a backoff, and eventually stops being retried', async () => {
    const db = createTestDb();
    const { destination } = createDestination(db, { name: 'Ops', url: 'https://example.com/h' }, SECRET, NOW);
    queueDelivery(db, { destinationId: destination.id, alertId: 'a1', payload: payload(), nowMs: NOW });

    let at = NOW;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await runNotifyJob(db, SECRET, at, { fetch: sending(500) });
      const [delivery] = listDeliveries(db, destination.id, 10);
      expect(delivery.attempts, `attempt ${attempt}`).toBe(attempt);
      if (attempt < MAX_ATTEMPTS) {
        expect(delivery.status).toBe('pending');
        // Not due yet: the backoff is what stops a broken receiver being hammered.
        expect(dueDeliveries(db, at, 10)).toHaveLength(0);
        at = delivery.nextAttemptAt as number;
      } else {
        // It stays as a failure rather than disappearing, which is how a broken destination stays visible.
        expect(delivery.status).toBe('failed');
        expect(delivery.nextAttemptAt).toBeNull();
      }
    }
    expect(listDestinations(db)[0].consecutiveFailures).toBe(MAX_ATTEMPTS);
  });

  it('counts failures in a row, and forgets them on a success', async () => {
    const db = createTestDb();
    const { destination } = createDestination(db, { name: 'Ops', url: 'https://example.com/h' }, SECRET, NOW);
    queueDelivery(db, { destinationId: destination.id, alertId: 'a1', payload: payload(), nowMs: NOW });
    await runNotifyJob(db, SECRET, NOW, { fetch: sending(500) });
    expect(listDestinations(db)[0].consecutiveFailures).toBe(1);

    queueDelivery(db, { destinationId: destination.id, alertId: 'a2', payload: payload(), nowMs: NOW });
    await runNotifyJob(db, SECRET, NOW, { fetch: sending(200) });
    expect(listDestinations(db)[0].consecutiveFailures).toBe(0);
    expect(listDestinations(db)[0].lastResult).toBe('ok');
  });

  it('THE RULING: a disabled destination receives nothing', async () => {
    const db = createTestDb();
    const { destination } = createDestination(db, { name: 'Ops', url: 'https://example.com/h' }, SECRET, NOW);
    queueDelivery(db, { destinationId: destination.id, alertId: 'a1', payload: payload(), nowMs: NOW });
    setDestinationEnabled(db, destination.id, false);

    const send = sending(200);
    await runNotifyJob(db, SECRET, NOW, { fetch: send });
    expect(send).not.toHaveBeenCalled();
    expect(listDeliveries(db, destination.id, 10)[0].status).toBe('failed');
  });

  it('does not retry a delivery whose destination was deleted', async () => {
    const db = createTestDb();
    const { destination } = createDestination(db, { name: 'Ops', url: 'https://example.com/h' }, SECRET, NOW);
    queueDelivery(db, { destinationId: destination.id, alertId: 'a1', payload: payload(), nowMs: NOW });
    deleteDestination(db, destination.id);
    // The delivery goes with it; there is nowhere to send it and nothing to sign it with.
    expect(dueDeliveries(db, NOW, 10)).toHaveLength(0);
  });
});
