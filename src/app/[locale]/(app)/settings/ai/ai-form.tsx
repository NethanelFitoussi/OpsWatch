'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { SubmitButton } from '@/components/submit-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AI_FAILURES } from '@/lib/ai/failures';
import { AI_PROVIDERS, AI_PROVIDER_SPECS, type AiProviderId } from '@/lib/ai/providers';
import type { FormAction } from '@/lib/forms/action-state';
import type { AiState } from './actions';

export type AiConnection = {
  provider: AiProviderId;
  model: string;
  baseUrl: string | null;
  status: 'configured' | 'untested' | 'failed';
  lastTestedAt: number | null;
  lastError: string | null;
  hasCredential: boolean;
};

/**
 * Configuring the optional AI provider.
 *
 * Three things the form is careful about. The key field is **always empty**: nothing stored is ever sent
 * back to the browser, so leaving it blank keeps what is there rather than clearing it. The status is
 * `untested` until a test passes — a saved key is a saved key, not a working one. And nothing here implies
 * OpsWatch needs it: with no provider configured every other surface works exactly as it does now.
 */
function isKnownFailure(value: string | null): value is (typeof AI_FAILURES)[number] {
  return value !== null && (AI_FAILURES as readonly string[]).includes(value);
}

export function AiForm({
  save,
  test,
  remove,
  current,
}: {
  save: FormAction<AiState>;
  test: FormAction<AiState>;
  remove: FormAction<AiState>;
  current: AiConnection | null;
}) {
  const t = useTranslations('Settings.ai');
  const [saveState, saveAction] = useActionState(save, {});
  const [testState, testAction] = useActionState(test, {});
  const [removeState, removeAction] = useActionState(remove, {});
  const [provider, setProvider] = useState<AiProviderId>(current?.provider ?? 'anthropic');
  const spec = AI_PROVIDER_SPECS[provider];

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
                <span className="ml-2">{t(`providers.${current.provider}`)}</span>
                <span className="ml-2 text-muted-foreground">{current.model}</span>
              </p>
              {/* A saved key is not a working key, and the page says which of the two it has. */}
              {current.status === 'untested' && <p className="text-sm text-muted-foreground">{t('untestedHint')}</p>}
              {/* Only a code from the closed list is rendered. Anything else is shown as a generic failure
                  rather than passed to the catalogue, which would throw on a string a provider chose. */}
              {current.status === 'failed' && (
                <p className="text-sm text-muted-foreground">
                  {t(`errors.${isKnownFailure(current.lastError) ? current.lastError : 'bad_response'}`)}
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <form action={testAction}>
                  <SubmitButton>{t('test')}</SubmitButton>
                </form>
                <form action={removeAction}>
                  <SubmitButton>{t('remove')}</SubmitButton>
                </form>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <form action={saveAction}>
        <Card>
          <CardHeader>
            <CardTitle>{current === null ? t('connect') : t('replace')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormErrorAlert message={saveState.error && t(`errors.${saveState.error}`)} />
            {saveState.saved && <p className="text-sm">{t('saved')}</p>}

            <p className="text-sm text-muted-foreground">{t('optional')}</p>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="provider">{t('provider')}</Label>
                <select
                  id="provider"
                  name="provider"
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as AiProviderId)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                >
                  {AI_PROVIDERS.map((one) => (
                    <option key={one} value={one}>
                      {t(`providers.${one}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="model">{t('model')}</Label>
                <Input id="model" name="model" required defaultValue={current?.model ?? spec.suggestedModel} key={provider} />
              </div>
            </div>

            {spec.customBaseUrl && (
              <div className="space-y-1">
                <Label htmlFor="baseUrl">{t('baseUrl')}</Label>
                <Input id="baseUrl" name="baseUrl" defaultValue={current?.baseUrl ?? ''} placeholder="https://models.example.com" />
                <p className="text-xs text-muted-foreground">{t('baseUrlHint')}</p>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="apiKey">{t('apiKey')}</Label>
              {/* Never pre-filled, and never sent back: what is stored stays where it is. */}
              <Input id="apiKey" name="apiKey" type="password" autoComplete="off" placeholder={current?.hasCredential ? t('keyKept') : ''} />
              <p className="text-xs text-muted-foreground">{current?.hasCredential ? t('keyKeptHint') : t('apiKeyHint')}</p>
            </div>

            <SubmitButton>{t('save')}</SubmitButton>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
