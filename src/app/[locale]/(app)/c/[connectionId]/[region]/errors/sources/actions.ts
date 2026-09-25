'use server';

import { revalidatePath } from 'next/cache';
import { resolveLocale } from '@/i18n/routing';
import { auditedAdmin } from '@/lib/auth/audited';
import { requireAdmin } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import { LOG_FORMATS, MAPPABLE_FIELDS, isUsableMap, presetById, type FieldMapValues, type LogFormat } from '@/lib/errors/source-presets';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';
import { resolveTarget } from '@/lib/monitoring/target';
import { searchLogGroups, type LogGroup } from '@/lib/monitoring/logs';
import { SEARCH_LIMIT, saveSource } from '@/lib/read/log-sources';

export type SourceState = ActionState<'invalid_group' | 'invalid_map' | 'invalid_format', { saved?: boolean }>;
export type SearchState = ActionState<'search_failed' | 'invalid_search', { groups?: LogGroup[]; searched?: string }>;

/**
 * Discovery, on demand only.
 *
 * `logs:DescribeLogGroups` is an AWS call, so it happens when somebody searches and not when the page opens.
 * An operator who has already configured their sources pays nothing to come back and look at them.
 */
export async function searchGroupsAction(
  locale: string,
  connectionId: string,
  region: string,
  _prev: SearchState,
  formData: FormData,
): Promise<SearchState> {
  await requireAdmin(resolveLocale(locale));
  const search = formString(formData, 'search').trim();
  if (search.length > 200) return { error: 'invalid_search' };

  const target = await resolveTarget({ connectionId, region });
  if (!target.ok) return { error: 'search_failed' };

  const result = await searchLogGroups(target.data, search);
  // The reason AWS gave is not shown raw: the page says what failed and what to do about it.
  if (!result.ok) return { error: 'search_failed' };
  return { groups: result.data.slice(0, SEARCH_LIMIT), searched: search };
}

/**
 * Saves one log source.
 *
 * Enabling one starts spending money — Logs Insights is billed per gigabyte scanned (§9.5) — so it is an
 * explicit submission by an administrator, and the checkbox is off until they tick it.
 */
export async function saveSourceAction(
  locale: string,
  connectionId: string,
  region: string,
  _prev: SourceState,
  formData: FormData,
): Promise<SourceState> {
  return auditedAdmin(resolveLocale(locale), 'log_source_update', 'log_source', async (): Promise<SourceState> => {
  const logGroup = formString(formData, 'logGroup').trim();
  if (logGroup === '' || logGroup.length > 512) return { error: 'invalid_group' };

  const format = formString(formData, 'format');
  if (!(LOG_FORMATS as readonly string[]).includes(format)) return { error: 'invalid_format' };

  // A preset fills the paths; anything typed over it wins, so a correction is never discarded.
  const preset = presetById(formString(formData, 'preset'));
  const fields: FieldMapValues = {};
  for (const field of MAPPABLE_FIELDS) {
    const typed = formString(formData, `field.${field}`).trim();
    const value = typed !== '' ? typed : (preset?.fields[field] ?? '');
    if (value !== '') fields[field] = value;
  }

  const enabled = formString(formData, 'enabled') === 'on';
  // Without a message path nothing can be fingerprinted, so enabling it would scan logs and find nothing.
  if (enabled && !isUsableMap(fields)) return { error: 'invalid_map' };

  const serviceId = formString(formData, 'serviceId').trim();
  saveSource(
    getDb(),
    {
      connectionId,
      scope: region,
      logGroup,
      serviceId: serviceId === '' ? null : serviceId,
      enabled,
      format: format as LogFormat,
      fields,
    },
    Date.now(),
  );

  revalidatePath(`/${resolveLocale(locale)}/c/${connectionId}/${region}/errors/sources`);
  return { saved: true };
  }, { connectionId });
}
