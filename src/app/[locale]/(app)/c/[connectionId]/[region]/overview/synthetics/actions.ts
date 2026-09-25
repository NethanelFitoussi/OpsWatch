'use server';

import { revalidatePath } from 'next/cache';
import { resolveLocale } from '@/i18n/routing';
import { auditedAdmin } from '@/lib/auth/audited';
import { encrypt } from '@/lib/crypto';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import type { Assertion } from '@/lib/detect/synthetic';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';
import { deleteCheck, upsertCheck } from '@/lib/store/synthetics';
import { isAcceptableUrl } from './url-guard';

export type CheckState = ActionState<'invalid_name' | 'invalid_url' | 'invalid_threshold' | 'invalid_headers' | 'not_found', { saved?: boolean }>;

export async function saveCheckAction(
  locale: string,
  connectionId: string,
  region: string,
  _prev: CheckState,
  formData: FormData,
): Promise<CheckState> {
  return auditedAdmin(resolveLocale(locale), 'synthetic_update', 'synthetic', async (): Promise<CheckState> => {
  const name = formString(formData, 'name').trim();
  if (name === '' || name.length > 100) return { error: 'invalid_name' };
  const url = formString(formData, 'url').trim();
  // Refused before it is stored: the fetch-time guard still applies, but a URL nobody can check should not
  // sit in the database looking configured.
  if (!isAcceptableUrl(url)) return { error: 'invalid_url' };

  const rawThreshold = formString(formData, 'latencyThresholdMs').trim();
  let latencyThresholdMs: number | null = null;
  if (rawThreshold !== '') {
    if (!/^\d{1,6}$/.test(rawThreshold)) return { error: 'invalid_threshold' };
    latencyThresholdMs = Number(rawThreshold);
  }

  const assertions: Assertion[] = [];
  const expectStatus = formString(formData, 'expectStatus').trim();
  if (expectStatus !== '') {
    const values = expectStatus.split(',').map((one) => Number(one.trim())).filter((one) => Number.isInteger(one) && one >= 100 && one <= 599);
    if (values.length > 0) assertions.push({ kind: 'status_in', values });
  }
  const contains = formString(formData, 'bodyContains').trim();
  if (contains !== '') assertions.push({ kind: 'body_contains', value: contains });

  // Headers arrive as `Name: value` lines. A secret one belongs in the encrypted blob, never in a column.
  const rawHeaders = formString(formData, 'headers').trim();
  let secretHeadersCiphertext: string | null | undefined;
  if (rawHeaders !== '') {
    const headers: Record<string, string> = {};
    for (const line of rawHeaders.split('\n')) {
      const at = line.indexOf(':');
      if (at <= 0) return { error: 'invalid_headers' };
      headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    secretHeadersCiphertext = encrypt(JSON.stringify(headers), env().OPSWATCH_SECRET, 'access-keys');
  }

  upsertCheck(
    getDb(),
    {
      connectionId,
      scope: region,
      name,
      url,
      enabled: formString(formData, 'enabled') === 'on',
      assertions,
      latencyThresholdMs,
      ...(secretHeadersCiphertext === undefined ? {} : { secretHeadersCiphertext }),
    },
    Date.now(),
  );

  revalidatePath(`/${resolveLocale(locale)}/c/${connectionId}/${region}/overview/synthetics`);
  return { saved: true };
  });
}

export async function deleteCheckAction(
  locale: string,
  connectionId: string,
  region: string,
  _prev: CheckState,
  formData: FormData,
): Promise<CheckState> {
  return auditedAdmin(resolveLocale(locale), 'synthetic_update', 'synthetic', async (): Promise<CheckState> => {
  const id = formString(formData, 'checkId').trim();
  if (id === '') return { error: 'invalid_name' };

  /*
   * The environment goes to the store, which will not delete outside it.
   *
   * The id arrives in a form field, so a delete that trusted it alone would let a post from one AWS
   * connection's page destroy a check — and its whole run history, which cascades — belonging to another
   * account in the same installation.
   *
   * `not_found`, not "forbidden": a check in another environment must read as absent rather than as
   * somebody else's, which is the rule the read side follows too.
   */
  if (deleteCheck(getDb(), connectionId, region, id) === 0) return { error: 'not_found' };
  revalidatePath(`/${resolveLocale(locale)}/c/${connectionId}/${region}/overview/synthetics`);
  return { saved: true };
  });
}
