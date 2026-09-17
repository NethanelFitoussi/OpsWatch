'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SetupState } from './actions';

export function SetupForm({ action }: { action: (prev: SetupState, data: FormData) => Promise<SetupState> }) {
  const t = useTranslations('Auth');
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t(`errors.${state.error}`)}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">{t('setup.email')}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t('setup.password')}</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required aria-describedby="password-hint" />
        <p id="password-hint" className="text-xs text-muted-foreground">{t('setup.passwordHint')}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">{t('setup.confirmPassword')}</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {t('setup.submit')}
      </Button>
    </form>
  );
}
