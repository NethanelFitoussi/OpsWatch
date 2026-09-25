'use server';

import { revalidatePath } from 'next/cache';
import { resolveLocale } from '@/i18n/routing';
import { auditedAdmin } from '@/lib/auth/audited';
import {
  disableManagedCollection,
  enableManagedCollection,
  rotateIngestSecret,
  startForwarding,
  stopForwarding,
  verifyForwarder,
} from '@/lib/aws/collection';
import { getDb } from '@/lib/db/client';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';
import { readCollection, writeCollection } from '@/lib/store/collection';

/**
 * Every operator decision about push collection.
 *
 * All of them audited as `connection_update`, because every one of them changes what leaves somebody's
 * AWS account — which is exactly the kind of thing §21 exists to record who did.
 *
 * The secret comes back from `enable` and `rotate` **once**, to the page that asked. No action reads it,
 * and no page can ask for it again.
 */

export type CollectionState = ActionState<
  'not_confirmed' | 'no_public_url' | 'conflict' | 'limit' | 'denied' | 'not_found' | 'failed' | 'invalid_arn' | 'invalid_retention',
  { secret?: string; saved?: boolean; owner?: string; removed?: number; failed?: number; verified?: boolean; version?: string | null }
>;

const refresh = (locale: string, connectionId: string) =>
  revalidatePath(`/${resolveLocale(locale)}/accounts/${connectionId}/collection`);

/**
 * Turns managed collection on.
 *
 * It requires an explicit confirmation from the form, not merely a click: what this enables is data
 * leaving somebody's AWS account, and a toggle that does that on a stray click is a toggle in the wrong
 * place. Nothing is forwarded by it — a log group still has to be chosen afterwards.
 */
export async function enableCollectionAction(locale: string, connectionId: string, _prev: CollectionState, formData: FormData): Promise<CollectionState> {
  return auditedAdmin(resolveLocale(locale), 'connection_update', 'connection', async (): Promise<CollectionState> => {
    if (formString(formData, 'confirm') !== 'on') return { error: 'not_confirmed' };
    const { secret } = enableManagedCollection(getDb(), connectionId, Date.now());
    refresh(locale, connectionId);
    return { secret };
  }, { subjectId: connectionId, connectionId });
}

export async function rotateSecretAction(locale: string, connectionId: string, _prev: CollectionState): Promise<CollectionState> {
  return auditedAdmin(resolveLocale(locale), 'connection_update', 'connection', async (): Promise<CollectionState> => {
    const { secret } = rotateIngestSecret(getDb(), connectionId, Date.now());
    refresh(locale, connectionId);
    return { secret };
  }, { subjectId: connectionId, connectionId });
}

/** Turns it off, removing every subscription first. The base integration is untouched. */
export async function disableCollectionAction(locale: string, connectionId: string, _prev: CollectionState): Promise<CollectionState> {
  return auditedAdmin(resolveLocale(locale), 'connection_update', 'connection', async (): Promise<CollectionState> => {
    const outcome = await disableManagedCollection(getDb(), connectionId, Date.now());
    refresh(locale, connectionId);
    return { removed: outcome.removed.length, failed: outcome.failed.length };
  }, { subjectId: connectionId, connectionId });
}

/** Confirms the forwarder against AWS. An ARN a browser supplied is a claim until this says otherwise. */
export async function verifyForwarderAction(locale: string, connectionId: string, region: string, _prev: CollectionState, formData: FormData): Promise<CollectionState> {
  return auditedAdmin(resolveLocale(locale), 'connection_update', 'connection', async (): Promise<CollectionState> => {
    const arn = formString(formData, 'forwarderArn').trim();
    // Shape-checked here so a typo is a message rather than an AWS call that fails obscurely.
    if (!/^arn:aws[a-z-]*:lambda:[a-z0-9-]+:\d{12}:function:[\w-]{1,140}$/.test(arn)) return { error: 'invalid_arn' };

    const outcome = await verifyForwarder(getDb(), connectionId, region, arn, Date.now());
    refresh(locale, connectionId);
    return outcome.ok ? { verified: true, version: outcome.version ?? null } : { error: 'failed' };
  }, { subjectId: connectionId, connectionId });
}

/** The two switches that are not "may anything be forwarded": the log source, and whether records are kept. */
export async function saveCollectionSettingsAction(locale: string, connectionId: string, _prev: CollectionState, formData: FormData): Promise<CollectionState> {
  return auditedAdmin(resolveLocale(locale), 'connection_update', 'connection', async (): Promise<CollectionState> => {
    const retention = Number(formString(formData, 'retentionHours'));
    if (!Number.isInteger(retention) || retention < 1 || retention > 720) return { error: 'invalid_retention' };

    writeCollection(
      getDb(),
      connectionId,
      {
        realtimeLogs: formString(formData, 'realtimeLogs') === 'on',
        persistLogs: formString(formData, 'persistLogs') === 'on',
        retentionHours: retention,
      },
      Date.now(),
    );
    refresh(locale, connectionId);
    return { saved: true };
  }, { subjectId: connectionId, connectionId });
}

/** Starts or stops forwarding one log group. The AWS call and the row move together. */
export async function toggleLogGroupAction(locale: string, connectionId: string, region: string, logGroup: string, enable: boolean): Promise<CollectionState> {
  return auditedAdmin(resolveLocale(locale), 'connection_update', 'connection', async (): Promise<CollectionState> => {
    const nowMs = Date.now();
    if (!enable) {
      const stopped = await stopForwarding(getDb(), connectionId, region, logGroup, nowMs);
      refresh(locale, connectionId);
      return stopped.ok ? { saved: true } : { error: stopped.reason ?? 'failed' };
    }

    // Refused before the AWS call: forwarding while the source switch is off would be sending records the
    // endpoint is going to refuse, and paying AWS for every one of them.
    if (!readCollection(getDb(), connectionId).realtimeLogs) return { error: 'failed' };

    const started = await startForwarding(getDb(), connectionId, region, logGroup, nowMs);
    refresh(locale, connectionId);
    if (started.ok) return { saved: true };
    return started.reason === 'conflict' ? { error: 'conflict', owner: started.owner } : { error: started.reason };
  }, { subjectId: connectionId, connectionId });
}
