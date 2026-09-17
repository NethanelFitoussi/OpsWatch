import { getTranslations } from 'next-intl/server';
import { identityErrorHint } from '@/lib/aws/identity-errors';

/** The AWS error name of a failed base identity lookup and the hint explaining it. */
export async function IdentityErrorDetails({ code }: { code: string }) {
  const t = await getTranslations('IdentityErrors');
  const hint = identityErrorHint(code);
  return (
    <>
      <span className="mt-1 block">{t('title', { code })}</span>
      <span className="mt-1 block">{hint ? t(`hints.${hint}`) : t('hints.generic')}</span>
    </>
  );
}
