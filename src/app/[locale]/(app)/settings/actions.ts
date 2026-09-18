'use server';

import { revalidatePath } from 'next/cache';
import { resolveLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';
import { SettingsInputError, appSettings, type SettingsInputErrorCode } from '@/lib/settings/repository';

export type SettingsFormState = ActionState<SettingsInputErrorCode, { saved: boolean }>;

/**
 * Saves the instance settings. Session first, before the form is read at all; Next.js verifies the
 * Server Action's own origin. An invalid value comes back as a code the form shows localized, never
 * clamped to the nearest offered one.
 */
export async function saveSettingsAction(requestedLocale: string, _prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  await requireAdmin(resolveLocale(requestedLocale));
  try {
    appSettings.save(getDb(), {
      refreshIntervalMs: formString(formData, 'refreshIntervalMs'),
      defaultRange: formString(formData, 'defaultRange'),
    });
  } catch (error) {
    if (error instanceof SettingsInputError) return { error: error.code };
    throw error;
  }
  // Every page reads these settings, so any page the router already holds is now out of date.
  revalidatePath('/', 'layout');
  return { saved: true };
}
