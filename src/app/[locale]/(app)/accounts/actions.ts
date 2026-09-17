'use server';

import { redirect as nextRedirect } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import { detectBaseIdentity, trustFor } from '@/lib/aws/identity';
import { quickCreateUrl, renderTemplateYaml } from '@/lib/aws/template';
import { uploadTemplate } from '@/lib/aws/template-upload';
import { requireAdmin } from '@/lib/auth/current';
import {
  ConnectionInputError,
  ConnectionNotFoundError,
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

/** Non-secret values echoed back so the form keeps them after an error. Secrets never are. */
export type FormValues = {
  name?: string;
  awsAccountId?: string;
  regions?: string[];
  roleArn?: string;
  accessKeyId?: string;
};

export type FormState = { error?: ConnectionInputErrorCode; values?: FormValues };

/** A connection removed meanwhile (another tab, a stale page) sends the admin back to the list. */
function redirectIfRemoved(error: unknown, locale: string): void {
  if (error instanceof ConnectionNotFoundError) {
    redirect({ href: '/accounts', locale });
  }
}

function inputError(error: unknown, values: FormValues, locale: string): FormState {
  redirectIfRemoved(error, locale);
  if (error instanceof ConnectionInputError) {
    return { error: error.code, values };
  }
  throw error;
}

export async function createConnectionAction(locale: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin(locale);
  const values = {
    name: String(formData.get('name') ?? ''),
    awsAccountId: String(formData.get('awsAccountId') ?? ''),
    regions: formData.getAll('regions').map(String),
  };
  let id: string;
  try {
    id = createConnection(getDb(), {
      name: values.name,
      method: String(formData.get('method') ?? ''),
      awsAccountId: values.awsAccountId.replace(/\D/g, ''),
      regions: values.regions,
    }).id;
  } catch (error) {
    return inputError(error, values, locale);
  }
  return redirect({ href: `/accounts/${id}`, locale });
}

export async function saveRoleArnAction(locale: string, id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin(locale);
  const roleArn = String(formData.get('roleArn') ?? '');
  try {
    setRoleArn(getDb(), id, roleArn);
  } catch (error) {
    return inputError(error, { roleArn }, locale);
  }
  credentialResolver.forget(id);
  return redirect({ href: `/accounts/${id}`, locale });
}

export async function saveAccessKeysAction(locale: string, id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin(locale);
  const accessKeyId = String(formData.get('accessKeyId') ?? '');
  try {
    setAccessKeys(
      getDb(),
      id,
      { accessKeyId, secretAccessKey: String(formData.get('secretAccessKey') ?? '') },
      env().OPSWATCH_SECRET,
    );
  } catch (error) {
    return inputError(error, { accessKeyId }, locale);
  }
  return redirect({ href: `/accounts/${id}`, locale });
}

export async function regenerateExternalIdAction(locale: string, id: string): Promise<void> {
  await requireAdmin(locale);
  try {
    regenerateExternalId(getDb(), id);
  } catch (error) {
    redirectIfRemoved(error, locale);
    throw error;
  }
  credentialResolver.forget(id);
  redirect({ href: `/accounts/${id}`, locale });
}

export async function launchStackAction(locale: string, id: string): Promise<void> {
  await requireAdmin(locale);
  const bucket = env().OPSWATCH_TEMPLATE_BUCKET;
  let row;
  try {
    row = getConnection(getDb(), id);
  } catch (error) {
    redirectIfRemoved(error, locale);
    throw error;
  }
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
