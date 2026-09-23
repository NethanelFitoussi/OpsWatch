'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { SubmitButton } from '@/components/submit-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CLOUDFLARE_FAILURES } from '@/lib/cloudflare/failures';
import type { FormAction } from '@/lib/forms/action-state';
import type { CloudflareState } from './actions';

export type CloudflareConnection = {
  status: 'configured' | 'untested' | 'failed';
  lastError: string | null;
  zones: { id: string; name: string }[];
  hasCredential: boolean;
};

/** Only a code from the closed list is rendered; anything else falls back rather than throwing. */
const FAILURES: readonly string[] = CLOUDFLARE_FAILURES;

/**
 * Connecting Cloudflare, in the order the decisions are actually made.
 *
 * Token, then verify, then **choose zones**. The third step is the one that matters: a token can usually
 * see every zone in an account, and reading all of them by default would put someone else's traffic on a
 * page nobody asked for it on. So nothing is watched until it is picked.
 *
 * The token field is always empty. Nothing stored is sent back to this browser.
 */
export function CloudflareForm({
  save,
  test,
  discover,
  saveZones,
  remove,
  current,
}: {
  save: FormAction<CloudflareState>;
  test: FormAction<CloudflareState>;
  discover: FormAction<CloudflareState>;
  saveZones: FormAction<CloudflareState>;
  remove: FormAction<CloudflareState>;
  current: CloudflareConnection | null;
}) {
  const t = useTranslations('Settings.cloudflare');
  const [saveState, saveAction] = useActionState(save, {});
  const [testState, testAction] = useActionState(test, {});
  const [discoverState, discoverAction] = useActionState(discover, {});
  const [zonesState, zonesAction] = useActionState(saveZones, {});
  const [removeState, removeAction] = useActionState(remove, {});

  const known = (value: string | null) => value !== null && FAILURES.includes(value);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('statusTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <FormErrorAlert message={testState.error && t(`errors.${testState.error}`)} />
          {testState.tested && <p className="text-sm">{t('testPassed')}</p>}
          {removeState.removed && <p className="text-sm">{t('removed')}</p>}

          {current === null ? (
            <>
              <p className="text-sm">{t('none')}</p>
              <p className="text-sm text-muted-foreground">{t('noneHint')}</p>
            </>
          ) : (
            <>
              <p className="text-sm">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tracking-wide uppercase">{t(`status.${current.status}`)}</span>
                <span className="ml-2 text-muted-foreground">
                  {current.zones.length === 0 ? t('noZones') : t('watching', { zones: current.zones.map((zone) => zone.name).join(', ') })}
                </span>
              </p>
              {current.status === 'untested' && <p className="text-sm text-muted-foreground">{t('untestedHint')}</p>}
              {current.status === 'failed' && (
                <p className="text-sm text-muted-foreground">{t(`errors.${known(current.lastError) ? current.lastError : 'bad_response'}`)}</p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <form action={testAction}>
                  <SubmitButton>{t('test')}</SubmitButton>
                </form>
                <form action={discoverAction}>
                  <SubmitButton>{t('discover')}</SubmitButton>
                </form>
                <form action={removeAction}>
                  <SubmitButton>{t('remove')}</SubmitButton>
                </form>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {discoverState.discovered !== undefined && (
        <form action={zonesAction}>
          <Card>
            <CardHeader>
              <CardTitle>{t('chooseZones')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormErrorAlert message={discoverState.error && t(`errors.${discoverState.error}`)} />
              {zonesState.zonesSaved && <p className="text-sm">{t('zonesSaved')}</p>}
              {/* Nothing is read until it is chosen, which is the whole point of this step. */}
              <p className="text-sm text-muted-foreground">{t('chooseZonesHint')}</p>

              <ul className="space-y-2">
                {discoverState.discovered.map((zone) => (
                  <li key={zone.id} className="flex items-center gap-2">
                    <input
                      id={`zone-${zone.id}`}
                      name="zone"
                      type="checkbox"
                      value={`${zone.id}|${zone.name}`}
                      defaultChecked={current?.zones.some((one) => one.id === zone.id)}
                      className="size-4"
                    />
                    <Label htmlFor={`zone-${zone.id}`}>
                      {zone.name} <span className="text-xs text-muted-foreground">{zone.status}</span>
                    </Label>
                  </li>
                ))}
              </ul>

              <SubmitButton>{t('saveZones')}</SubmitButton>
            </CardContent>
          </Card>
        </form>
      )}

      <form action={saveAction}>
        <Card>
          <CardHeader>
            <CardTitle>{current === null ? t('connect') : t('replace')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormErrorAlert message={saveState.error && t(`errors.${saveState.error}`)} />
            {saveState.saved && <p className="text-sm">{t('saved')}</p>}

            <p className="text-sm text-muted-foreground">{t('scopes')}</p>

            <div className="space-y-1">
              <Label htmlFor="token">{t('token')}</Label>
              {/* Never pre-filled, and never sent back. */}
              <Input id="token" name="token" type="password" autoComplete="off" required placeholder={current?.hasCredential ? t('tokenKept') : ''} />
              <p className="text-xs text-muted-foreground">{t('tokenHint')}</p>
            </div>

            <SubmitButton>{t('save')}</SubmitButton>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
