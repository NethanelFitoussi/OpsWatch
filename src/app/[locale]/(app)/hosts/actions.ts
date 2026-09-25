'use server';

import { revalidatePath } from 'next/cache';
import { resolveLocale } from '@/i18n/routing';
import { redirect } from '@/i18n/navigation';
import { auditedAdmin } from '@/lib/auth/audited';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';
import { createHost, deleteHost, renameHost } from '@/lib/store/hosts';

/**
 * Enrolling a Linux host, renaming one, and removing one.
 *
 * The secret comes back from the server exactly once, to the page that just created the host, and is
 * never read from the database by a page again — the only accessor is the signature check. A host whose
 * secret was lost is a host to remove and enrol again, which costs one command.
 */

export type HostState = ActionState<'name_invalid' | 'no_public_url' | 'not_found', { hostId?: string; secret?: string }>;

const NAME_MAX = 80;

export async function createHostAction(locale: string, _prev: HostState, formData: FormData): Promise<HostState> {
  return auditedAdmin(resolveLocale(locale), 'host_enrol', 'host', async (): Promise<HostState> => {
    const name = formString(formData, 'name').trim();
    if (name === '' || name.length > NAME_MAX) return { error: 'name_invalid' };
    // Without a public URL there is nowhere for an agent to post, and an install command pointing at
    // nothing is worse than a refusal that names the setting.
    if (!env().OPSWATCH_PUBLIC_URL) return { error: 'no_public_url' };

    const { host, agentSecret } = createHost(getDb(), { name, nowMs: Date.now() }, env().OPSWATCH_SECRET);
    revalidatePath(`/${resolveLocale(locale)}/hosts`);
    // Shown once, on the page that asked for it. A page that could read it again could leak it.
    return { hostId: host.id, secret: agentSecret };
  });
}

export async function renameHostAction(locale: string, id: string, _prev: HostState, formData: FormData): Promise<HostState> {
  return auditedAdmin(resolveLocale(locale), 'host_update', 'host', async (): Promise<HostState> => {
    const name = formString(formData, 'name').trim();
    if (name === '' || name.length > NAME_MAX) return { error: 'name_invalid' };
    if (renameHost(getDb(), id, name, Date.now()) === 0) return { error: 'not_found' };
    revalidatePath(`/${resolveLocale(locale)}/hosts/${id}`);
    return {};
  });
}

export async function deleteHostAction(requestedLocale: string, id: string): Promise<void> {
  const locale = resolveLocale(requestedLocale);
  await auditedAdmin(locale, 'host_remove', 'host', async () => {
    // Samples cascade. The agent on the machine keeps running until somebody removes it, and its
    // reports are refused from then on — which is the honest outcome of removing a host from here.
    deleteHost(getDb(), id);
    return {};
  });
  redirect({ href: '/hosts', locale });
}
