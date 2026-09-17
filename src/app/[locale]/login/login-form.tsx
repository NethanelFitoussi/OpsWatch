'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { LoginState } from './actions';

export function LoginForm({ action }: { action: (prev: LoginState, data: FormData) => Promise<LoginState> }) {
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
        <Label htmlFor="email">{t('login.email')}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" defaultValue={state.email} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t('login.password')}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {t('login.submit')}
      </Button>
    </form>
  );
}
