'use server';

import { redirect as nextRedirect } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import { resolveLocale, type AppLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/auth/current';
import { awsErrorCode } from '@/lib/aws/errors';
import { quickCreateUrl } from '@/lib/aws/template';
import { uploadTemplate } from '@/lib/aws/template-upload';
import {
  ConnectionInputError,
  ConnectionNotFoundError,
  createConnection,
  deleteConnection,
  findConnection,
  regenerateExternalId,
  setAccessKeys,
  setRoleArn,
  type ConnectionInputErrorCode,
} from '@/lib/connections/repository';
import { credentialResolver } from '@/lib/connections/resolver';
import { isTemplateReady, renderConnectionTemplate } from '@/lib/connections/template';
import { getDb, type Db } from '@/lib/db/client';
import { env } from '@/lib/env';
import type { ActionState } from '@/lib/forms/action-state';
import { formString, formStrings } from '@/lib/forms/form-data';
import { logConnectionEvent } from '@/lib/log';

/** Non-secret values echoed back so the form keeps them after an error. Secrets never are. */
type FormValues = {
  name?: string;
  awsAccountId?: string;
  regions?: string[];
  roleArn?: string;
  accessKeyId?: string;
};

export type FormState = ActionState<ConnectionInputErrorCode, { values: FormValues }>;

/** Checks the session and returns the locale to redirect with (the bound argument comes from the client). */
async function authorize(requestedLocale: string): Promise<AppLocale> {
  const locale = resolveLocale(requestedLocale);
  await requireAdmin(locale);
  return locale;
}

/** What a change needs: the values to echo back on invalid input (null without a form), and the change. */
type Change = { values: FormValues | null; mutate: (db: Db) => { id: string } };

/**
 * Checks the session, then reads the form (`prepare`) and runs one change, and shows the connection page.
 * A connection removed meanwhile (another tab, a stale page) sends the admin back to the list. Invalid
 * input goes back to the form with `values`, or is rethrown when there is no form (`values` null).
 * Cached credentials of the connection are dropped.
 */
async function mutateConnection(requestedLocale: string, prepare: () => Change): Promise<FormState> {
  const locale = await authorize(requestedLocale);
  const { values, mutate } = prepare();
  let id: string;
  try {
    id = mutate(getDb()).id;
  } catch (error) {
    if (error instanceof ConnectionNotFoundError) {
      return redirect({ href: '/accounts', locale });
    }
    if (error instanceof ConnectionInputError && values) {
      return { error: error.code, values };
    }
    throw error;
  }
  credentialResolver.forget(id);
  return redirect({ href: `/accounts/${id}`, locale });
}

export async function createConnectionAction(locale: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return mutateConnection(locale, () => {
    const values = {
      name: formString(formData, 'name'),
      awsAccountId: formString(formData, 'awsAccountId'),
      regions: formStrings(formData, 'regions'),
    };
    return {
      values,
      mutate: (db) =>
        createConnection(db, {
          name: values.name,
          method: formString(formData, 'method'),
          awsAccountId: values.awsAccountId.replace(/\D/g, ''),
          regions: values.regions,
        }),
    };
  });
}

export async function saveRoleArnAction(locale: string, id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return mutateConnection(locale, () => {
    const roleArn = formString(formData, 'roleArn');
    return { values: { roleArn }, mutate: (db) => setRoleArn(db, id, roleArn) };
  });
}

export async function saveAccessKeysAction(locale: string, id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return mutateConnection(locale, () => {
    const accessKeyId = formString(formData, 'accessKeyId');
    const secretAccessKey = formString(formData, 'secretAccessKey');
    return {
      values: { accessKeyId },
      mutate: (db) => setAccessKeys(db, id, { accessKeyId, secretAccessKey }, env().OPSWATCH_SECRET),
    };
  });
}

export async function regenerateExternalIdAction(locale: string, id: string): Promise<void> {
  await mutateConnection(locale, () => ({ values: null, mutate: (db) => regenerateExternalId(db, id) }));
}

export async function launchStackAction(requestedLocale: string, id: string): Promise<void> {
  const locale = await authorize(requestedLocale);
  const row = findConnection(getDb(), id);
  if (!row) {
    return redirect({ href: '/accounts', locale });
  }
  const failed = { href: { pathname: `/accounts/${id}`, query: { error: 'launch_failed' } }, locale };
  const bucket = env().OPSWATCH_TEMPLATE_BUCKET;
  if (!bucket || !isTemplateReady(row)) {
    return redirect(failed);
  }
  const region = row.regions[0];
  try {
    await uploadTemplate({ bucket, connectionId: id, region, body: await renderConnectionTemplate(row) });
  } catch (error) {
    logConnectionEvent({ event: 'launch_stack', connectionId: id, ok: false, errorCode: awsErrorCode(error) });
    return redirect(failed);
  }
  nextRedirect(quickCreateUrl({ bucket, connectionId: id, region }));
}

export async function deleteConnectionAction(requestedLocale: string, id: string): Promise<void> {
  const locale = await authorize(requestedLocale);
  deleteConnection(getDb(), id);
  credentialResolver.forget(id);
  redirect({ href: '/accounts', locale });
}
