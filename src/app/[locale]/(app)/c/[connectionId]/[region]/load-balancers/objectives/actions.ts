'use server';

import { revalidatePath } from 'next/cache';
import { resolveLocale } from '@/i18n/routing';
import { auditedAdmin } from '@/lib/auth/audited';
import { getDb } from '@/lib/db/client';
import { SLO_KINDS, type SloKind } from '@/lib/db/schema';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';
import { deleteSloDefinition, listSloDefinitions, upsertSloDefinition } from '@/lib/store/slos';
import { MAX_WINDOW_DAYS } from '@/lib/read/slos';

/**
 * Defining and removing service level objectives (§19).
 *
 * Every field is checked before it is stored. An objective of 150 %, a window of a decade or a latency
 * target with no threshold are not things a page should quietly accept and then measure against: a
 * definition that cannot be measured is worse than none, because it looks configured.
 */

export type ObjectiveState = ActionState<
  'invalid_name' | 'invalid_kind' | 'invalid_subject' | 'invalid_objective' | 'invalid_threshold' | 'invalid_window' | 'not_found',
  { saved?: boolean }
>;

export async function saveObjectiveAction(
  locale: string,
  connectionId: string,
  region: string,
  _prev: ObjectiveState,
  formData: FormData,
): Promise<ObjectiveState> {
  return auditedAdmin(resolveLocale(locale), 'slo_update', 'slo', async (): Promise<ObjectiveState> => {
    const name = formString(formData, 'name').trim();
    if (name === '' || name.length > 100) return { error: 'invalid_name' };

    const kind = formString(formData, 'kind').trim();
    if (!(SLO_KINDS as readonly string[]).includes(kind)) return { error: 'invalid_kind' };

    const subjectId = formString(formData, 'subjectId').trim();
    if (subjectId === '' || subjectId.length > 200) return { error: 'invalid_subject' };

    // Typed as a percentage, because that is how an objective is spoken about. Stored as a fraction.
    const rawObjective = formString(formData, 'objective').trim();
    const objective = Number(rawObjective) / 100;
    // 100 % is allowed and means "no budget at all", which the arithmetic handles rather than dividing by zero.
    if (!/^\d{1,3}(?:\.\d{1,4})?$/.test(rawObjective) || !(objective > 0) || objective > 1) return { error: 'invalid_objective' };

    const rawThreshold = formString(formData, 'latencyThresholdMs').trim();
    let latencyThresholdMs: number | null = null;
    if (rawThreshold !== '') {
      if (!/^\d{1,6}$/.test(rawThreshold) || Number(rawThreshold) === 0) return { error: 'invalid_threshold' };
      latencyThresholdMs = Number(rawThreshold);
    }
    // A latency objective with nothing to compare against would measure every interval as unmeasured and
    // report "not enough history" forever, which reads as a collection problem rather than a missing field.
    if (kind === 'latency' && latencyThresholdMs === null) return { error: 'invalid_threshold' };

    const rawWindow = formString(formData, 'windowDays').trim();
    const windowDays = Number(rawWindow);
    if (!/^\d{1,3}$/.test(rawWindow) || windowDays < 1 || windowDays > MAX_WINDOW_DAYS) return { error: 'invalid_window' };

    upsertSloDefinition(
      getDb(),
      {
        connectionId,
        scope: region,
        name,
        kind: kind as SloKind,
        subjectId,
        objective,
        latencyThresholdMs,
        windowDays,
        enabled: formString(formData, 'enabled') === 'on',
      },
      Date.now(),
    );

    revalidatePath(`/${resolveLocale(locale)}/c/${connectionId}/${region}/load-balancers/objectives`);
    return { saved: true };
  }, { connectionId });
}

export async function deleteObjectiveAction(
  locale: string,
  connectionId: string,
  region: string,
  _prev: ObjectiveState,
  formData: FormData,
): Promise<ObjectiveState> {
  return auditedAdmin(resolveLocale(locale), 'slo_update', 'slo', async (): Promise<ObjectiveState> => {
    const id = formString(formData, 'objectiveId').trim();
    // Scoped by listing this environment's definitions: one belonging elsewhere reads as absent rather
    // than as somebody else's, which is the rule every other list here follows.
    const mine = listSloDefinitions(getDb(), connectionId, region).find((definition) => definition.id === id);
    if (mine === undefined) return { error: 'not_found' };

    deleteSloDefinition(getDb(), mine.id);
    revalidatePath(`/${resolveLocale(locale)}/c/${connectionId}/${region}/load-balancers/objectives`);
    return { saved: true };
  }, { connectionId });
}
