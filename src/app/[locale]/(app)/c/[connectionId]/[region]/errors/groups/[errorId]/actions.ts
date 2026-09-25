'use server';

import { revalidatePath } from 'next/cache';
import { resolveLocale } from '@/i18n/routing';
import { auditedAdmin } from '@/lib/auth/audited';
import { getDb } from '@/lib/db/client';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';
import { clearMapping, setMapping } from '@/lib/store/repositories';

export type MappingState = ActionState<'invalid_repository' | 'invalid_service', { saved?: boolean }>;

/**
 * Accepts a suggested repository for a service, or corrects one.
 *
 * This is the moment §13's rule matters: a suggestion becomes a mapping only here, by a person pressing a
 * button, and the row records `declared` because that is what it now is. §I asks for a mapping a user can
 * inspect and correct, and the moment they most want to correct it is while looking at the wrong code.
 */
export async function acceptMappingAction(
  locale: string,
  connectionId: string,
  region: string,
  _prev: MappingState,
  formData: FormData,
): Promise<MappingState> {
  return auditedAdmin(resolveLocale(locale), 'repository_update', 'service_repository', async (): Promise<MappingState> => {
  const serviceId = formString(formData, 'serviceId').trim();
  if (serviceId === '') return { error: 'invalid_service' };
  const repositoryId = formString(formData, 'repositoryId').trim();

  const db = getDb();
  if (repositoryId === '') {
    // An empty choice clears it, so a wrong mapping is undoable from where it is noticed.
    clearMapping(db, connectionId, region, serviceId);
  } else {
    const pathPrefix = formString(formData, 'pathPrefix').trim();
    setMapping(
      db,
      { connectionId, scope: region, serviceId, repositoryId, pathPrefix: pathPrefix === '' ? null : pathPrefix, source: 'declared' },
      Date.now(),
    );
  }

  revalidatePath(`/${resolveLocale(locale)}/c/${connectionId}/${region}/errors/groups`);
  return { saved: true };
  }, { connectionId });
}
