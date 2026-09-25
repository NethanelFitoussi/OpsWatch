'use server';

import { revalidatePath } from 'next/cache';
import { resolveLocale } from '@/i18n/routing';
import { auditedAdmin } from '@/lib/auth/audited';
import { getDb } from '@/lib/db/client';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';
import { appendTimeline, dismissIncident, findIncident, setIncidentStatus } from '@/lib/store/incidents';

export type IncidentActionState = ActionState<'not_found' | 'invalid_status' | 'empty_note', { saved?: boolean }>;

const STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;

/**
 * Moves an incident along, or dismisses one OpsWatch raised.
 *
 * Dismissal is only offered for an auto-created incident, because dismissing one a person opened would be
 * deleting their judgement rather than overruling OpsWatch's (§16).
 */
export async function updateIncidentAction(
  locale: string,
  connectionId: string,
  region: string,
  _prev: IncidentActionState,
  formData: FormData,
): Promise<IncidentActionState> {
  return auditedAdmin(resolveLocale(locale), 'incident_dismiss', 'incident', async (adminId): Promise<IncidentActionState> => {
    const db = getDb();
    const id = formString(formData, 'incidentId').trim();
    const incident = findIncident(db, id);
    // Scoped: an id from another environment reads as absent, not as somebody else's.
    if (incident === null || incident.connectionId !== connectionId || incident.scope !== region) return { error: 'not_found' };

    const intent = formString(formData, 'intent');
    const nowMs = Date.now();

    if (intent === 'dismiss') {
      if (incident.origin !== 'auto') return { error: 'not_found' };
      dismissIncident(db, id, nowMs, String(adminId));
    } else if (intent === 'note') {
      const note = formString(formData, 'note').trim();
      // A note with no words is not a note, and an empty timeline entry is worse than none.
      if (note === '') return { error: 'empty_note' };
      appendTimeline(db, { incidentId: id, at: nowMs, kind: 'note', actorId: String(adminId), note });
    } else {
      if (!(STATUSES as readonly string[]).includes(intent)) return { error: 'invalid_status' };
      setIncidentStatus(db, id, intent as (typeof STATUSES)[number], nowMs, String(adminId));
    }

    revalidatePath(`/${resolveLocale(locale)}/c/${connectionId}/${region}/overview/incidents/${id}`);
    return { saved: true };
  }, { connectionId });
}
