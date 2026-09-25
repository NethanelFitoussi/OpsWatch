'use server';

import { revalidatePath } from 'next/cache';
import { resolveLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/auth/current';
import { listConnections } from '@/lib/connections/repository';
import { isUsableStatus } from '@/lib/connections/types';
import { writePreferences } from '@/lib/store/preferences';
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

export type DefaultEnvironmentState = ActionState<'unknown_environment', { saved: boolean }>;

/**
 * Saves which environment this person's own pages open in.
 *
 * Checked against what the installation actually has rather than stored as typed: a value that named a
 * connection nobody has would send every section link to a 404, and a preference is not a place to
 * discover that. The empty string clears it, which is a real choice and not a failure.
 */
export async function saveDefaultEnvironmentAction(
  requestedLocale: string,
  _prev: DefaultEnvironmentState,
  formData: FormData,
): Promise<DefaultEnvironmentState> {
  const locale = resolveLocale(requestedLocale);
  const adminId = await requireAdmin(locale);
  const value = formString(formData, 'defaultEnvironmentId').trim();

  if (value !== '') {
    const [connectionId, region] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
    const known = listConnections(getDb()).some(
      (connection) => connection.id === connectionId && isUsableStatus(connection.status) && connection.regions.includes(region),
    );
    if (!known) return { error: 'unknown_environment' };
  }

  writePreferences(getDb(), adminId, { defaultEnvironmentId: value === '' ? null : value }, Date.now());
  // Every section link off a monitoring page is computed from it, so the whole shell is out of date.
  revalidatePath('/', 'layout');
  return { saved: true };
}
