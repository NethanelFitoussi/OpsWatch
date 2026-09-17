import { getTranslations } from 'next-intl/server';
import { SectionCard } from '@/components/section-card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { lookUpBaseIdentity } from '@/lib/aws/identity';
import { IdentityErrorDetails } from './identity-error-details';

/** The identity an ambient connection uses. Looks it up, so render it inside a Suspense boundary. */
export async function AmbientSection({ region }: { region: string }) {
  const t = await getTranslations('AccountDetail.ambient');
  const { identity, errorCode } = await lookUpBaseIdentity(region);
  return (
    <SectionCard title={t('title')} description={t('description')} contentClassName="text-sm">
      {identity ? <p>{t('detected', { arn: identity.arn })}</p> : (
        <Alert variant="destructive">
          <AlertDescription>
            <span className="block">{t('missing')}</span>
            <IdentityErrorDetails code={errorCode} />
          </AlertDescription>
        </Alert>
      )}
    </SectionCard>
  );
}
