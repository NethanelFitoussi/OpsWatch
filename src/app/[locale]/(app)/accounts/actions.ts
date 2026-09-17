'use server';

import { redirect as nextRedirect } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import { detectBaseIdentity, trustFor } from '@/lib/aws/identity';
import { quickCreateUrl, renderTemplateYaml } from '@/lib/aws/template';
import { uploadTemplate } from '@/lib/aws/template-upload';
import { requireAdmin } from '@/lib/auth/current';
import {
  ConnectionInputError,
  createConnection,
  deleteConnection,
  getConnection,
  regenerateExternalId,
  setAccessKeys,
  setRoleArn,
  type ConnectionInputErrorCode,
} from '@/lib/connections/repository';
import { credentialResolver } from '@/lib/connections/resolver';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';

export type FormState = { error?: ConnectionInputErrorCode };

function inputError(error: unknown): FormState {
  if (error instanceof ConnectionInputError) {
    return { error: error.code };
  }
  throw error;
}

export async function createConnectionAction(locale: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin(locale);
  let id: string;
  try {
    id = createConnection(getDb(), {
      name: String(formData.get('name') ?? ''),
      method: String(formData.get('method') ?? ''),
      awsAccountId: String(formData.get('awsAccountId') ?? '').replace(/\D/g, ''),
      regions: formData.getAll('regions').map(String),
    }).id;
  } catch (error) {
    return inputError(error);
  }
  return redirect({ href: `/accounts/${id}`, locale });
}

export async function saveRoleArnAction(locale: string, id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin(locale);
  try {
    setRoleArn(getDb(), id, String(formData.get('roleArn') ?? ''));
  } catch (error) {
    return inputError(error);
  }
  credentialResolver.forget(id);
  return redirect({ href: `/accounts/${id}`, locale });
}

export async function saveAccessKeysAction(locale: string, id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin(locale);
  try {
    setAccessKeys(
      getDb(),
      id,
      { accessKeyId: String(formData.get('accessKeyId') ?? ''), secretAccessKey: String(formData.get('secretAccessKey') ?? '') },
      env().OPSWATCH_SECRET,
    );
  } catch (error) {
    return inputError(error);
  }
  return redirect({ href: `/accounts/${id}`, locale });
}

export async function regenerateExternalIdAction(locale: string, id: string): Promise<void> {
  await requireAdmin(locale);
  regenerateExternalId(getDb(), id);
  credentialResolver.forget(id);
  redirect({ href: `/accounts/${id}`, locale });
}

export async function launchStackAction(locale: string, id: string): Promise<void> {
  await requireAdmin(locale);
  const bucket = env().OPSWATCH_TEMPLATE_BUCKET;
  const row = getConnection(getDb(), id);
  let url: string;
  try {
    if (!bucket || !row.externalId) {
      throw new Error('launch stack unavailable');
    }
    const region = row.regions[0];
    const identity = await detectBaseIdentity(region);
    const body = renderTemplateYaml({ connectionId: id, externalId: row.externalId, trust: trustFor(identity) });
    await uploadTemplate({ bucket, connectionId: id, region, body });
    url = quickCreateUrl({ bucket, connectionId: id, region });
  } catch {
    return redirect({ href: { pathname: `/accounts/${id}`, query: { error: 'launch_failed' } }, locale });
  }
  nextRedirect(url);
}

export async function deleteConnectionAction(locale: string, id: string): Promise<void> {
  await requireAdmin(locale);
  deleteConnection(getDb(), id);
  credentialResolver.forget(id);
  redirect({ href: '/accounts', locale });
}
