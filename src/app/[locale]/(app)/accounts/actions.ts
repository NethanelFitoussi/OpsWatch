'use server';

import { redirect as nextRedirect } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import { resolveLocale, type AppLocale } from '@/i18n/routing';
import { auditedAdmin, recordAdminAction } from '@/lib/auth/audited';
import { requireAdmin } from '@/lib/auth/current';
import type { AuditAction } from '@/lib/store/audit';
import { disableManagedCollection } from '@/lib/aws/collection';
import { awsErrorCode } from '@/lib/aws/errors';
import { quickCreateUrl } from '@/lib/aws/template';
import { uploadTemplate } from '@/lib/aws/template-upload';
import { testDoConnection } from '@/lib/do/check';
import { testGoogleConnection } from '@/lib/gcp/check';
import { openConnectionKey } from '@/lib/gcp/issuer';
import { revalidatePath } from 'next/cache';
import {
  ConnectionInputError,
  ConnectionNotFoundError,
  createConnection,
  createGoogleConnection,
  createDoConnection,
  readDoToken,
  saveDoTestResult,
  deleteConnection,
  findConnection,
  regenerateExternalId,
  setAccessKeys,
  setNameAndRegions,
  saveGoogleTestResult,
  setRoleArn,
  type ConnectionInputErrorCode,
} from '@/lib/connections/repository';
import { credentialResolver } from '@/lib/connections/resolver';
import { purgeConnectionData } from '@/lib/store/connection-data';
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

/** Checks the session and returns the locale to redirect with, and who is acting. */
async function authorize(requestedLocale: string): Promise<{ locale: AppLocale; adminId: number }> {
  const locale = resolveLocale(requestedLocale);
  const adminId = await requireAdmin(locale);
  return { locale, adminId };
}

/** What a change needs: the values to echo back on invalid input (null without a form), and the change. */
type Change = { values: FormValues | null; mutate: (db: Db) => { id: string } };

/**
 * Checks the session, then reads the form (`prepare`) and runs one change, and shows the connection page.
 * A connection removed meanwhile (another tab, a stale page) sends the admin back to the list. Invalid
 * input goes back to the form with `values`, or is rethrown when there is no form (`values` null).
 * Cached credentials of the connection are dropped.
 */
async function mutateConnection(requestedLocale: string, action: AuditAction, prepare: () => Change): Promise<FormState> {
  const { locale, adminId } = await authorize(requestedLocale);
  const { values, mutate } = prepare();
  let id: string;
  try {
    id = mutate(getDb()).id;
  } catch (error) {
    if (error instanceof ConnectionNotFoundError) {
      return redirect({ href: '/accounts', locale });
    }
    if (error instanceof ConnectionInputError && values) {
      // Refused, not failed, and recorded as such: an administrator did try to change this.
      await recordAdminAction({ adminId, action, subjectType: 'connection', result: 'denied', details: { reason: error.code } });
      return { error: error.code, values };
    }
    throw error;
  }
  // Written here rather than around the call, because creating a connection does not know its id until
  // the connection exists, and because a successful change ends in a redirect and never returns.
  await recordAdminAction({ adminId, action, subjectType: 'connection', subjectId: id, connectionId: id, result: 'ok' });
  credentialResolver.forget(id);
  return redirect({ href: `/accounts/${id}`, locale });
}

export async function createConnectionAction(locale: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return mutateConnection(locale, 'connection_create', () => {
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

/**
 * Renames a connection and changes the regions it reads.
 *
 * An edit, not a delete and a re-create: the connection keeps its id, so every problem, metric and log
 * already filed under it stays where it is. What cannot be edited — the AWS account and the credential
 * method — is not in the form, because changing either would keep that history while changing whose it is.
 */
export async function saveConnectionDetailsAction(locale: string, id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return mutateConnection(locale, 'connection_update', () => {
    const values = { name: formString(formData, 'name'), regions: formStrings(formData, 'regions') };
    return { values, mutate: (db) => setNameAndRegions(db, id, values) };
  });
}

export async function saveRoleArnAction(locale: string, id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return mutateConnection(locale, 'connection_update', () => {
    const roleArn = formString(formData, 'roleArn');
    return { values: { roleArn }, mutate: (db) => setRoleArn(db, id, roleArn) };
  });
}

// A credential, replaced: `credential_rotate` rather than `connection_update`, because "somebody
// changed the keys to this AWS account" is the line a reviewer is looking for.
export async function saveAccessKeysAction(locale: string, id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return mutateConnection(locale, 'credential_rotate', () => {
    const accessKeyId = formString(formData, 'accessKeyId');
    const secretAccessKey = formString(formData, 'secretAccessKey');
    return {
      values: { accessKeyId },
      mutate: (db) => setAccessKeys(db, id, { accessKeyId, secretAccessKey }, env().OPSWATCH_SECRET),
    };
  });
}

export async function regenerateExternalIdAction(locale: string, id: string): Promise<void> {
  await mutateConnection(locale, 'credential_rotate', () => ({ values: null, mutate: (db) => regenerateExternalId(db, id) }));
}

/**
 * Connects a Google Cloud project.
 *
 * Nothing secret is submitted, so nothing is echoed back that should not be: every field is a name the
 * operator can read off their own console. The connection is created in `draft` — it has a key, and it
 * has not proved anything yet, and those are different states.
 */
export async function createGoogleConnectionAction(locale: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { locale: resolved, adminId } = await authorize(locale);
  const values = { name: formString(formData, 'name') };
  let id: string;
  try {
    id = createGoogleConnection(
      getDb(),
      {
        name: values.name,
        projectId: formString(formData, 'projectId'),
        projectNumber: formString(formData, 'projectNumber'),
        poolId: formString(formData, 'poolId'),
        providerId: formString(formData, 'providerId'),
        serviceAccount: formString(formData, 'serviceAccount'),
        // One per line or comma-separated: an operator pasting from the console does either.
        regions: formString(formData, 'regions')
          .split(/[\s,]+/)
          .map((one) => one.trim())
          .filter((one) => one !== ''),
      },
      env().OPSWATCH_SECRET,
    ).id;
  } catch (error) {
    if (error instanceof ConnectionInputError) {
      await recordAdminAction({ adminId, action: 'connection_create', subjectType: 'connection', result: 'denied', details: { reason: error.code } });
      return { error: error.code, values };
    }
    throw error;
  }
  await recordAdminAction({ adminId, action: 'connection_create', subjectType: 'connection', subjectId: id, connectionId: id, result: 'ok' });
  return redirect({ href: `/accounts/${id}`, locale: resolved });
}

/**
 * Connects a DigitalOcean account.
 *
 * The token is a secret, so unlike every other connection form nothing is echoed back on an error but
 * the name: a field repopulated with somebody's token is a token in a page's HTML.
 */
export async function createDoConnectionAction(locale: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { locale: resolved, adminId } = await authorize(locale);
  const values = { name: formString(formData, 'name') };
  let id: string;
  try {
    id = createDoConnection(getDb(), { name: values.name, token: formString(formData, 'token') }, env().OPSWATCH_SECRET).id;
  } catch (error) {
    if (error instanceof ConnectionInputError) {
      await recordAdminAction({ adminId, action: 'connection_create', subjectType: 'connection', result: 'denied', details: { reason: error.code } });
      return { error: error.code, values };
    }
    throw error;
  }
  await recordAdminAction({ adminId, action: 'connection_create', subjectType: 'connection', subjectId: id, connectionId: id, result: 'ok' });
  return redirect({ href: `/accounts/${id}`, locale: resolved });
}

/** Asks DigitalOcean what this token can read, and writes down the answer. */
export async function verifyDoAction(locale: string, id: string, _prev: FormState): Promise<FormState> {
  return auditedAdmin(
    resolveLocale(locale),
    'connection_test',
    'connection',
    async (): Promise<FormState> => {
      const db = getDb();
      const row = findConnection(db, id);
      if (row === null || row.provider !== 'do') return { error: 'not_ready' };

      const result = await testDoConnection({ token: readDoToken(row, env().OPSWATCH_SECRET), nowMs: Date.now() });
      saveDoTestResult(db, id, result, result.failure === null ? 'ok' : 'failed');
      revalidatePath(`/${resolveLocale(locale)}/accounts/${id}`);
      return {};
    },
    { subjectId: id, connectionId: id },
  );
}

/**
 * Asks Google what this connection can read, and writes down the answer.
 *
 * It never changes anything in the project — two reads, with `maxResults=1` — and it never throws for
 * a refusal: "Google would not accept the token" is the most likely outcome while somebody is still
 * setting this up, and it belongs on the page rather than in a 500.
 */
export async function verifyGoogleAction(locale: string, id: string, _prev: FormState): Promise<FormState> {
  return auditedAdmin(
    resolveLocale(locale),
    'connection_test',
    'connection',
    async (): Promise<FormState> => {
      const db = getDb();
      const row = findConnection(db, id);
      if (row === null || row.provider !== 'gcp') return { error: 'not_ready' };

      const result = await testGoogleConnection({
        connectionId: row.id,
        projectId: row.gcpProjectId ?? '',
        target: {
          projectNumber: row.gcpProjectNumber ?? '',
          poolId: row.gcpPoolId ?? '',
          providerId: row.gcpProviderId ?? '',
          serviceAccount: row.gcpServiceAccount,
        },
        key: row.gcpKeyCiphertext === null ? null : openConnectionKey(row.gcpKeyCiphertext, env().OPSWATCH_SECRET),
        baseUrl: env().OPSWATCH_PUBLIC_URL,
        nowMs: Date.now(),
      });

      // Usable when something can actually be read. Every check denied is a connection that
      // authenticated and cannot see anything, which is not a working connection.
      const readable = result.checks.filter((check) => check.status === 'ok').length;
      saveGoogleTestResult(db, id, result, readable === 0 ? 'failed' : readable < result.checks.length ? 'degraded' : 'ok');
      revalidatePath(`/${resolveLocale(locale)}/accounts/${id}`);
      return {};
    },
    { subjectId: id, connectionId: id },
  );
}

export async function launchStackAction(requestedLocale: string, id: string): Promise<void> {
  const { locale } = await authorize(requestedLocale);
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
  const { locale, adminId } = await authorize(requestedLocale);
  // Forwarding is stopped **before** the connection goes, while OpsWatch can still assume the role that
  // removes the subscriptions. Afterwards there is no credential left to do it with, and the filters
  // would keep invoking a Lambda that delivers to an integration which no longer exists.
  await disableManagedCollection(getDb(), id, Date.now());
  // And everything that connection wrote. Without this the problems, alerts, error groups, deployments,
  // log sources, saved searches and history of an account the operator explicitly disconnected stayed in
  // the database for ever: unreachable through any page, because every page is scoped, but still there.
  const removed = purgeConnectionData(getDb(), id);
  deleteConnection(getDb(), id);
  credentialResolver.forget(id);
  // The row that says this happened, and how much went with it. Without it the one action in the
  // product that destroys an operator's data irreversibly left no trace that it had been taken.
  await recordAdminAction({ adminId, action: 'connection_delete', subjectType: 'connection', subjectId: id, connectionId: id, result: 'ok', details: { rowsRemoved: removed } });
  redirect({ href: '/accounts', locale });
}
