'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { CodeBlock } from '@/components/code-block';
import { FormErrorAlert } from '@/components/form-error-alert';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormAction } from '@/lib/forms/action-state';
import type { CollectionState } from './actions';

/**
 * The controls for managed collection.
 *
 * The one that matters most is the first: enabling it is a confirmed decision with the consequences
 * written out, not a toggle that acts on a stray click. What it turns on is data leaving somebody's AWS
 * account, and the sentence explaining that belongs beside the control rather than in a guide.
 *
 * The secret is rendered exactly where it is created, with the warning that it will not be shown again —
 * there is no page that can ask for it a second time.
 */

const EMPTY: CollectionState = {};

function Secret({ secret }: { secret: string | undefined }) {
  const t = useTranslations('Collection');
  if (secret === undefined) return null;
  return (
    <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="text-sm font-medium">{t('secretTitle')}</p>
      <p className="mt-1 mb-2 text-sm text-muted-foreground">{t('secretHint')}</p>
      <CodeBlock value={secret} />
    </div>
  );
}

function Problem({ state }: { state: CollectionState }) {
  const t = useTranslations('Collection');
  if (state.error === undefined) return null;
  // A conflict names whose filter is in the way, because "it did not work" is not something to act on.
  const message = state.error === 'conflict' && state.owner !== undefined ? t('errors.conflictWith', { owner: state.owner }) : t(`errors.${state.error}`);
  return <FormErrorAlert message={message} />;
}

export function EnableCollectionForm({ action, canEnable }: { action: FormAction<CollectionState>; canEnable: boolean }) {
  const t = useTranslations('Collection');
  const [state, formAction] = useActionState(action, EMPTY);

  return (
    <form action={formAction} className="space-y-3">
      <Problem state={state} />
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>{t('enable.what')}</li>
        <li>{t('enable.creates')}</li>
        <li>{t('enable.costs')}</li>
        <li>{t('enable.nothingYet')}</li>
      </ul>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-0.5 size-4" />
        <span>{t('enable.confirm')}</span>
      </label>
      {/* Not a disabled button with a shrug: a forwarder needs an address AWS can reach, and if there is
          none the page says which setting is missing. */}
      {canEnable ? <SubmitButton>{t('enable.submit')}</SubmitButton> : <p className="text-sm text-destructive">{t('errors.no_public_url')}</p>}
      <Secret secret={state.secret} />
    </form>
  );
}

export function DisableCollectionForm({ action }: { action: FormAction<CollectionState> }) {
  const t = useTranslations('Collection');
  const [state, formAction] = useActionState(action, EMPTY);
  const [armed, setArmed] = useState(false);

  return (
    <form action={formAction} className="space-y-3">
      <Problem state={state} />
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>{t('disable.subscriptions')}</li>
        <li>{t('disable.secret')}</li>
        <li>{t('disable.records')}</li>
        {/* The sentence that stops this reading as "disconnect AWS". */}
        <li className="font-medium text-foreground">{t('disable.keepsConnection')}</li>
      </ul>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={armed} onChange={(event) => setArmed(event.target.checked)} className="mt-0.5 size-4" />
        <span>{t('disable.confirm')}</span>
      </label>
      <SubmitButton disabled={!armed}>{t('disable.submit')}</SubmitButton>
      {state.removed !== undefined && (
        <p className="text-sm text-muted-foreground">
          {t('disable.removed', { count: state.removed })}
          {state.failed !== undefined && state.failed > 0 ? ` ${t('disable.failed', { count: state.failed })}` : ''}
        </p>
      )}
    </form>
  );
}

export function VerifyForwarderForm({ action, current }: { action: FormAction<CollectionState>; current: string | null }) {
  const t = useTranslations('Collection');
  const [state, formAction] = useActionState(action, EMPTY);

  return (
    <form action={formAction} className="space-y-3">
      <Problem state={state} />
      <div className="space-y-1">
        <Label htmlFor="forwarderArn">{t('verify.label')}</Label>
        <Input id="forwarderArn" name="forwarderArn" defaultValue={current ?? ''} placeholder="arn:aws:lambda:eu-west-1:123456789012:function:opswatch-…-forwarder" className="font-mono text-xs" />
        <p className="text-xs text-muted-foreground">{t('verify.hint')}</p>
      </div>
      <SubmitButton>{t('verify.submit')}</SubmitButton>
      {state.verified === true && (
        <p className="text-sm text-muted-foreground">{t('verify.ok', { version: state.version ?? t('verify.unknownVersion') })}</p>
      )}
    </form>
  );
}

/**
 * A new signing secret.
 *
 * The old one stops working the moment this returns, which is the point — and which is why the button
 * says so beside itself rather than in a guide: between rotating here and updating the stack parameter,
 * the forwarder cannot deliver.
 */
export function RotateSecretForm({ action }: { action: FormAction<CollectionState> }) {
  const t = useTranslations('Collection');
  const [state, formAction] = useActionState(action, EMPTY);

  return (
    <form action={formAction} className="space-y-2">
      <Problem state={state} />
      <p className="text-sm text-muted-foreground">{t('rotate.hint')}</p>
      <Button type="submit" variant="outline" size="sm">
        {t('rotate.submit')}
      </Button>
      <Secret secret={state.secret} />
    </form>
  );
}

export function CollectionSettingsForm({
  action,
  settings,
}: {
  action: FormAction<CollectionState>;
  settings: { realtimeLogs: boolean; persistLogs: boolean; retentionHours: number };
}) {
  const t = useTranslations('Collection');
  const [state, formAction] = useActionState(action, EMPTY);
  const [persist, setPersist] = useState(settings.persistLogs);

  return (
    <form action={formAction} className="space-y-4">
      <Problem state={state} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="realtimeLogs" defaultChecked={settings.realtimeLogs} className="mt-0.5 size-4" />
        <span>
          <span className="font-medium">{t('settings.realtime')}</span>
          <span className="block text-muted-foreground">{t('settings.realtimeHint')}</span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="persistLogs" checked={persist} onChange={(event) => setPersist(event.target.checked)} className="mt-0.5 size-4" />
        <span>
          <span className="font-medium">{t('settings.persist')}</span>
          {/* Forwarding and keeping are different decisions, and the page says which is which. */}
          <span className="block text-muted-foreground">{persist ? t('settings.persistOn') : t('settings.persistOff')}</span>
        </span>
      </label>

      <div className="space-y-1">
        <Label htmlFor="retentionHours">{t('settings.retention')}</Label>
        <Input id="retentionHours" name="retentionHours" type="number" min={1} max={720} defaultValue={settings.retentionHours} className="w-32" disabled={!persist} />
        <p className="text-xs text-muted-foreground">{t('settings.retentionHint')}</p>
      </div>

      <SubmitButton>{t('settings.submit')}</SubmitButton>
      {state.saved === true && <p className="text-sm text-muted-foreground">{t('settings.saved')}</p>}
    </form>
  );
}

/** One log group, with the state of its subscription and the button that changes it. */
export function LogGroupToggle({
  logGroup,
  active,
  failure,
  onToggle,
  disabled,
}: {
  logGroup: string;
  active: boolean;
  failure: string | null;
  onToggle: FormAction<CollectionState>;
  disabled: boolean;
}) {
  const t = useTranslations('Collection');
  const [state, formAction] = useActionState(onToggle, EMPTY);

  return (
    <li className="space-y-1 border-b py-2 last:border-b-0">
      <form action={formAction} className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 font-mono text-xs break-all">{logGroup}</span>
        <span className="flex shrink-0 items-center gap-3">
          <span className={active ? 'text-sm text-emerald-700 dark:text-emerald-400' : 'text-sm text-muted-foreground'}>
            {active ? t('groups.forwarding') : t('groups.notForwarding')}
          </span>
          <Button type="submit" variant="outline" size="sm" disabled={disabled}>
            {active ? t('groups.stop') : t('groups.start')}
          </Button>
        </span>
      </form>
      {failure !== null && <p className="text-xs text-destructive">{t(`errors.${failure}`)}</p>}
      <Problem state={state} />
    </li>
  );
}
