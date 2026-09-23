'use server';

import { revalidatePath } from 'next/cache';
import { resolveLocale } from '@/i18n/routing';
import { auditedAdmin } from '@/lib/auth/audited';
import {
  discoverZones,
  removeCloudflareConnection,
  saveCloudflareToken,
  saveCloudflareZones,
  testCloudflareConnection,
} from '@/lib/cloudflare/connection';
import { getDb } from '@/lib/db/client';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';

/**
 * Connecting, verifying and disconnecting Cloudflare (§20, CF-1).
 *
 * The token arrives here, is encrypted and is never sent back. A failure is a code from a closed list, so
 * Cloudflare's own error text — which can quote a token id — cannot reach a page or the database.
 */

export type CloudflareState = ActionState<
  'invalid_token' | 'no_zones' | 'not_configured' | 'unauthorized' | 'forbidden' | 'rate_limited' | 'unreachable' | 'bad_response' | 'timeout',
  { saved?: boolean; tested?: boolean; removed?: boolean; zonesSaved?: boolean; discovered?: { id: string; name: string; status: string }[] }
>;

/** A Cloudflare API token is opaque. OpsWatch checks only that it is plausible. */
const TOKEN = /^[A-Za-z0-9_-]{30,200}$/;

export async function saveCloudflareTokenAction(locale: string, _prev: CloudflareState, formData: FormData): Promise<CloudflareState> {
  return auditedAdmin(resolveLocale(locale), 'cloudflare_update', 'cloudflare', async (): Promise<CloudflareState> => {
    const token = formString(formData, 'token').trim();
    if (!TOKEN.test(token)) return { error: 'invalid_token' };

    saveCloudflareToken(getDb(), token, Date.now());
    revalidatePath(`/${resolveLocale(locale)}/settings/cloudflare`);
    return { saved: true };
  });
}

export async function testCloudflareAction(locale: string, _prev: CloudflareState, _formData: FormData): Promise<CloudflareState> {
  return auditedAdmin(resolveLocale(locale), 'cloudflare_test', 'cloudflare', async (): Promise<CloudflareState> => {
    const result = await testCloudflareConnection(getDb(), Date.now());
    revalidatePath(`/${resolveLocale(locale)}/settings/cloudflare`);
    return result.ok ? { tested: true } : { error: result.error };
  });
}

/** Discovery, so an operator picks a zone from what exists rather than pasting an id they looked up. */
export async function discoverZonesAction(locale: string, _prev: CloudflareState, _formData: FormData): Promise<CloudflareState> {
  return auditedAdmin(resolveLocale(locale), 'cloudflare_test', 'cloudflare', async (): Promise<CloudflareState> => {
    const result = await discoverZones(getDb());
    if (!result.ok) return { error: result.error };
    return result.zones.length === 0 ? { error: 'no_zones' } : { discovered: result.zones };
  });
}

export async function saveZonesAction(locale: string, _prev: CloudflareState, formData: FormData): Promise<CloudflareState> {
  return auditedAdmin(resolveLocale(locale), 'cloudflare_update', 'cloudflare', async (): Promise<CloudflareState> => {
    // Each selected zone arrives as `id|name`, so the page can list what is watched without a network call.
    const chosen = formData
      .getAll('zone')
      .map((value) => String(value))
      .map((value) => {
        const at = value.indexOf('|');
        return at <= 0 ? null : { id: value.slice(0, at), name: value.slice(at + 1) };
      })
      .filter((zone): zone is { id: string; name: string } => zone !== null);

    saveCloudflareZones(getDb(), chosen, Date.now());
    revalidatePath(`/${resolveLocale(locale)}/settings/cloudflare`);
    return { zonesSaved: true };
  });
}

export async function removeCloudflareAction(locale: string, _prev: CloudflareState, _formData: FormData): Promise<CloudflareState> {
  return auditedAdmin(resolveLocale(locale), 'cloudflare_update', 'cloudflare', async (): Promise<CloudflareState> => {
    removeCloudflareConnection(getDb());
    revalidatePath(`/${resolveLocale(locale)}/settings/cloudflare`);
    return { removed: true };
  });
}
