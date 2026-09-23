'use server';

import { revalidatePath } from 'next/cache';
import { resolveLocale } from '@/i18n/routing';
import { auditedAdmin } from '@/lib/auth/audited';
import { getDb } from '@/lib/db/client';
import { HISTORY_CATEGORIES, type HistoryCategoryId } from '@/lib/db/schema';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';
import { writeHistorySettings } from '@/lib/history/settings';

export type HistoryState = ActionState<'invalid_interval' | 'invalid_retention', { saved?: boolean }>;

/**
 * Saves the history switch.
 *
 * Enabling it is the one setting in OpsWatch that starts spending an operator's money, so it is an explicit
 * form submission by an administrator, never an inferred default — and §21 records that somebody made it.
 */
export async function saveHistoryAction(locale: string, _prev: HistoryState, formData: FormData): Promise<HistoryState> {
  return auditedAdmin(resolveLocale(locale), 'history_update', 'settings', async (): Promise<HistoryState> => {
    const interval = Number(formString(formData, 'intervalMinutes'));
    if (!Number.isInteger(interval) || interval < 1 || interval > 1440) return { error: 'invalid_interval' };
    const retention = Number(formString(formData, 'retentionDays'));
    if (!Number.isInteger(retention) || retention < 1 || retention > 3650) return { error: 'invalid_retention' };

    const chosen = formData.getAll('categories').map(String);
    const categories = HISTORY_CATEGORIES.filter((category) => chosen.includes(category)) as HistoryCategoryId[];

    writeHistorySettings(
      getDb(),
      {
        enabled: formString(formData, 'enabled') === 'on',
        // Any value in range: §31.1 allows a custom interval, not only the six the form offers.
        intervalMinutes: interval,
        categories,
        retentionDays: retention,
      },
      Date.now(),
    );
    revalidatePath(`/${resolveLocale(locale)}/settings/history`);
    return { saved: true };
  });
}
