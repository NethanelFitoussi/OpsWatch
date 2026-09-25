'use server';

import { revalidatePath } from 'next/cache';
import { resolveLocale } from '@/i18n/routing';
import { auditedAdmin } from '@/lib/auth/audited';
import { getDb } from '@/lib/db/client';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';
import { acknowledgeAlert, listAlerts, listRules, setRuleEnabled } from '@/lib/store/alerts';

export type AlertActionState = ActionState<'not_found' | 'already_acknowledged', { saved?: boolean }>;

/**
 * Acknowledging an alert (§15.2).
 *
 * The action that makes the acknowledgement rule reachable: until now the collector honoured it and nobody
 * could set it. Acknowledging stops the alert announcing itself until it resolves and fires again.
 */
export async function acknowledgeAlertAction(
  locale: string,
  connectionId: string,
  region: string,
  _prev: AlertActionState,
  formData: FormData,
): Promise<AlertActionState> {
  return auditedAdmin(resolveLocale(locale), 'alert_acknowledge', 'alert', async (adminId): Promise<AlertActionState> => {
    const db = getDb();
    const id = formString(formData, 'alertId').trim();

    // Scoped by listing this environment's alerts rather than by fetching the id: an alert from another
    // environment must read as absent, not as somebody else's.
    const alert = listAlerts(db, connectionId, region, 500).find((row) => row.id === id);
    if (alert === undefined) return { error: 'not_found' };
    // Acknowledging twice is not an error worth a message, but it is not a change either.
    if (alert.acknowledgedAt !== null) return { error: 'already_acknowledged' };

    acknowledgeAlert(db, id, Date.now(), String(adminId));
    revalidatePath(`/${resolveLocale(locale)}/c/${connectionId}/${region}/overview/alerts`);
    return { saved: true };
  }, { connectionId });
}

/** Turning a rule off, which §15.1 promises is possible because the install rules are ordinary rules. */
export async function toggleRuleAction(
  locale: string,
  connectionId: string,
  region: string,
  _prev: AlertActionState,
  formData: FormData,
): Promise<AlertActionState> {
  return auditedAdmin(resolveLocale(locale), 'alert_rule_update', 'alert_rule', async (): Promise<AlertActionState> => {
    const db = getDb();
    const id = formString(formData, 'ruleId').trim();
    const rule = listRules(db, connectionId, region).find((row) => row.id === id);
    if (rule === undefined) return { error: 'not_found' };

    setRuleEnabled(db, id, !rule.enabled);
    revalidatePath(`/${resolveLocale(locale)}/c/${connectionId}/${region}/overview/alerts`);
    return { saved: true };
  }, { connectionId });
}
