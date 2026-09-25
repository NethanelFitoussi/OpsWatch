'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { resolveLocale } from '@/i18n/routing';
import { auditedAdmin } from '@/lib/auth/audited';
import { listConnections } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';
import { deliver } from '@/lib/notify/deliver';
import type { AlertPayload } from '@/lib/notify/payload';
import { writeDigestSettings } from '@/lib/store/digest-settings';
import { createDestination, deleteDestination, findDestination, recordAttempt, secretOf, setDestinationEnabled } from '@/lib/store/notifications';

/**
 * Creating, testing and removing a webhook destination (§15, ALE-4).
 *
 * §15's promise in one file: nothing leaves the instance until somebody here creates a destination, and
 * the signing secret is returned exactly once — to the page that just created it, never to a page that
 * renders an existing one.
 */

export type NotifyState = ActionState<
  'name_invalid' | 'url_invalid' | 'connection_unknown' | 'not_found' | 'http' | 'timeout' | 'network',
  { signingSecret?: string; tested?: boolean }
>;

const nameSchema = z.string().trim().min(1).max(80);

/**
 * HTTPS only, and no credentials in the URL.
 *
 * A webhook body is signed, not encrypted: over plain HTTP anybody on the path reads the alert. And
 * `user:pass@` in a URL is a credential OpsWatch would then be storing in a column that is not encrypted
 * for one.
 */
const urlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const parsed = URL.parse(value);
    return parsed !== null && parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '';
  });

const failure = (error: string | undefined): NotifyState['error'] =>
  error === 'timeout' ? 'timeout' : error === 'network' ? 'network' : 'http';

export async function createDestinationAction(locale: string, _prev: NotifyState, formData: FormData): Promise<NotifyState> {
  return auditedAdmin(resolveLocale(locale), 'notify_update', 'notify', async (): Promise<NotifyState> => {
    const name = nameSchema.safeParse(formString(formData, 'name'));
    if (!name.success) return { error: 'name_invalid' };
    const url = urlSchema.safeParse(formString(formData, 'url'));
    if (!url.success) return { error: 'url_invalid' };

    /*
     * Which account's alerts this endpoint receives. Empty means all of them, which is the default and
     * the whole meaning of an installation with one AWS account.
     *
     * Checked against what this installation has rather than stored as typed: a destination scoped to a
     * connection nobody has would receive nothing at all, silently, for ever.
     */
    const connectionId = formString(formData, 'connectionId').trim();
    if (connectionId !== '' && !listConnections(getDb()).some((connection) => connection.id === connectionId)) {
      return { error: 'connection_unknown' };
    }

    const { signingSecret } = createDestination(
      getDb(),
      { name: name.data, url: url.data, connectionId: connectionId === '' ? null : connectionId },
      env().OPSWATCH_SECRET,
      Date.now(),
    );
    revalidatePath(`/${resolveLocale(locale)}/settings/notifications`);
    // Shown once. A page that could read it again is a page that could leak it.
    return { signingSecret };
  });
}

export async function testDestinationAction(locale: string, id: string, _prev: NotifyState, _formData: FormData): Promise<NotifyState> {
  return auditedAdmin(resolveLocale(locale), 'notify_test', 'notify', async (): Promise<NotifyState> => {
    const db = getDb();
    const destination = findDestination(db, id);
    const signingSecret = destination === null ? null : secretOf(db, id, env().OPSWATCH_SECRET);
    if (destination === null || signingSecret === null) return { error: 'not_found' };

    const nowMs = Date.now();
    const payload: AlertPayload = {
      id: `test-${nowMs}`,
      alertId: 'test',
      kind: 'alert.fired',
      severity: 'info',
      title: 'Alerts.test',
      subject: 'opswatch:test',
      environment: 'test',
      firedAt: nowMs,
      url: null,
    };
    const outcome = await deliver(destination, payload, signingSecret, { nowMs });
    recordAttempt(db, id, { ok: outcome.ok, error: outcome.error, atMs: nowMs });
    revalidatePath(`/${resolveLocale(locale)}/settings/notifications`);
    return outcome.ok ? { tested: true } : { error: failure(outcome.error) };
  });
}

export async function toggleDestinationAction(locale: string, id: string, enabled: boolean): Promise<void> {
  await auditedAdmin(resolveLocale(locale), 'notify_update', 'notify', async () => {
    setDestinationEnabled(getDb(), id, enabled);
    revalidatePath(`/${resolveLocale(locale)}/settings/notifications`);
    return {};
  });
}

export async function deleteDestinationAction(locale: string, id: string): Promise<void> {
  await auditedAdmin(resolveLocale(locale), 'notify_update', 'notify', async () => {
    deleteDestination(getDb(), id);
    revalidatePath(`/${resolveLocale(locale)}/settings/notifications`);
    return {};
  });
}

/**
 * The weekly summary switch (REP-7).
 *
 * Audited as `notify_update`, like every other change to where things go: turning a scheduled send on is
 * a decision about what leaves the instance, and §21 records who made it.
 *
 * The day and the hour are checked against their ranges rather than clamped. A form that silently turns
 * "hour 25" into "hour 23" would send a summary at a time nobody chose.
 */
export type DigestState = ActionState<'invalid_day' | 'invalid_hour', { saved?: boolean }>;

export async function saveDigestAction(locale: string, _prev: DigestState, formData: FormData): Promise<DigestState> {
  return auditedAdmin(resolveLocale(locale), 'notify_update', 'settings', async (): Promise<DigestState> => {
    const dayOfWeek = Number(formString(formData, 'dayOfWeek'));
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return { error: 'invalid_day' };
    const hourUtc = Number(formString(formData, 'hourUtc'));
    if (!Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23) return { error: 'invalid_hour' };

    writeDigestSettings(getDb(), { enabled: formString(formData, 'enabled') === 'on', dayOfWeek, hourUtc }, Date.now());
    revalidatePath(`/${resolveLocale(locale)}/settings/notifications`);
    return { saved: true };
  });
}
