'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { CodeBlock } from '@/components/code-block';
import { FormErrorAlert } from '@/components/form-error-alert';
import { FormField } from '@/components/form-field';
import { SubmitButton } from '@/components/submit-button';
import type { FormAction } from '@/lib/forms/action-state';
import { installCommand } from '@/lib/hosts/install-command';
import type { HostState } from './actions';

/**
 * Enrolling a host, and the one command that follows.
 *
 * The key comes back from the server exactly once and is rendered here, inside the command, with the
 * warning that it will not be shown again. It is never read from the database by a page — the only
 * accessor is the signature check on the reports.
 *
 * The command is shown rather than run, and it downloads from this instance rather than the internet:
 * it saves the script, prints its checksum so the operator can compare it with the one on this page,
 * and only then installs it. Piping an unauthenticated script straight into a root shell is the thing
 * this is deliberately not.
 */
export function EnrolHostForm({
  action,
  baseUrl,
  digest,
}: {
  action: FormAction<HostState>;
  /** Where this OpsWatch answers, so the command points at the operator's own instance. */
  baseUrl: string;
  digest: string;
}) {
  const t = useTranslations('Hosts.enrol');
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4">
      <FormErrorAlert message={state.error ? t(`errors.${state.error}`) : undefined} />
      <div className="max-w-md">
        <FormField id="name" label={t('name')} hint={t('nameHint')} required maxLength={80} />
      </div>
      <SubmitButton>{t('create')}</SubmitButton>

      {state.hostId !== undefined && state.secret !== undefined && (
        <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <div>
            <p className="text-sm font-medium">{t('secretTitle')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('secretHint')}</p>
          </div>
          <CodeBlock label={t('commandLabel')} value={installCommand({ baseUrl, hostId: state.hostId, secret: state.secret })} />
          <div>
            <p className="text-sm">{t('checksum')}</p>
            <CodeBlock value={digest} />
          </div>
          <p className="text-sm text-muted-foreground">{t('afterwards')}</p>
        </div>
      )}
    </form>
  );
}

export function RenameHostForm({ action, name }: { action: FormAction<HostState>; name: string }) {
  const t = useTranslations('Hosts.detail');
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="min-w-64">
        <FormField id="name" label={t('name')} defaultValue={name} required maxLength={80} />
      </div>
      <SubmitButton>{t('save')}</SubmitButton>
      {state.error !== undefined && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${state.error}`)}
        </p>
      )}
    </form>
  );
}
