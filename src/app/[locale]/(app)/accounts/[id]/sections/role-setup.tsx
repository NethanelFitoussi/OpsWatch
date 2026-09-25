import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { CodeBlock } from '@/components/code-block';
import { SectionCard } from '@/components/section-card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { lookUpBaseIdentity } from '@/lib/aws/identity';
import { deployCommand, partitionOf, roleArnCommand, roleArnFor } from '@/lib/aws/template';
import type { ConnectionView } from '@/lib/connections/repository';
import { env } from '@/lib/env';
import { launchStackAction, regenerateExternalIdAction, saveRoleArnAction } from '../../actions';
import { RoleArnForm } from '../forms';
import { IdentityErrorDetails } from './identity-error-details';

type SectionProps = { view: ConnectionView; locale: AppLocale };

/** Steps ① and ②, which depend on OpsWatch's own identity: render them inside a Suspense boundary. */
export async function RoleIdentityAndTemplate({ view, locale, error }: SectionProps & { error?: string }) {
  const t = await getTranslations('AccountDetail.role');
  const { identity, errorCode } = await lookUpBaseIdentity(view.regions[0]);

  return (
    <>
      <SectionCard step={1} title={t('identityTitle')} contentClassName="space-y-2 text-sm">
          {identity ? (
            <p>{t('identityDetected', { arn: identity.arn })}</p>
          ) : (
            <Alert variant="destructive">
              <AlertDescription>
                <span className="block">
                  {t('identityMissing')}{' '}
                  <Link href="/getting-started#step-0" className="font-medium underline underline-offset-4">{t('guideLink')}</Link>
                </span>
                <IdentityErrorDetails code={errorCode} />
              </AlertDescription>
            </Alert>
          )}
      </SectionCard>

      <SectionCard step={2} title={t('deployTitle')} description={t('deployHelp', { account: view.awsAccountId ?? '' })} contentClassName="space-y-5">
          {view.templateOutdated && (
            <Alert><AlertDescription>{t('outdated')}</AlertDescription></Alert>
          )}
          {error === 'no_base_identity' && (
            <Alert variant="destructive"><AlertDescription>{t('noBaseIdentity')}</AlertDescription></Alert>
          )}
          {error === 'launch_failed' && (
            <Alert variant="destructive"><AlertDescription>{t('launchFailed')}</AlertDescription></Alert>
          )}
          <div>
            <p className="mb-1 text-sm font-medium">{t('externalIdTitle')}</p>
            <p className="mb-2 text-xs text-muted-foreground">{t('externalIdHelp')}</p>
            <CodeBlock value={view.externalId ?? ''} />
          </div>
          <div className="flex flex-wrap gap-2">
            {identity ? (
              <Button asChild>
                <a href={`/api/connections/${view.id}/template`}>
                  <Download className="size-4" aria-hidden /> {t('download')}
                </a>
              </Button>
            ) : (
              <>
                <Button type="button" disabled aria-describedby="download-unavailable">
                  <Download className="size-4" aria-hidden /> {t('download')}
                </Button>
                <p id="download-unavailable" className="self-center text-xs text-muted-foreground">
                  {t('downloadUnavailable')}
                </p>
              </>
            )}
            {env().OPSWATCH_TEMPLATE_BUCKET && identity && (
              <form action={launchStackAction.bind(null, locale, view.id)}>
                <Button type="submit" variant="outline">
                  <ExternalLink className="size-4" aria-hidden /> {t('launchStack')}
                </Button>
              </form>
            )}
          </div>
          {/*
            * Said rather than hidden. The one-click path needs an S3 bucket, because the CloudFormation
            * console will only fetch a template from Amazon S3 — a self-hosted OpsWatch cannot serve it
            * from its own URL. An operator who never learns the button exists cannot decide whether to
            * set one up.
            */}
          {!env().OPSWATCH_TEMPLATE_BUCKET && (
            <p className="text-sm text-muted-foreground">{t('launchUnavailable')}</p>
          )}
          <div>
            <p className="mb-2 text-sm">{t('cliLabel')}</p>
            <CodeBlock value={deployCommand(view.id, view.regions[0])} />
          </div>
          <form action={regenerateExternalIdAction.bind(null, locale, view.id)} className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="ghost" size="sm">
              <RefreshCw className="size-4" aria-hidden /> {t('regenerate')}
            </Button>
            <span className="text-xs text-muted-foreground">{t('regenerateHelp')}</span>
          </form>
      </SectionCard>
    </>
  );
}

/** Step ③: paste the role ARN. It does not depend on OpsWatch's identity. */
export async function RoleArnCard({ view, locale }: SectionProps) {
  const t = await getTranslations('AccountDetail.role');
  /*
   * The ARN the stack creates, worked out rather than asked for.
   *
   * Account, role name and partition are all known before the stack exists: the account is what this
   * connection is for, the role name is derived from its id, and the partition follows from the region.
   * Asking an operator to run a CLI query and paste the answer back was asking them to fetch a string
   * OpsWatch could write down — and it is exactly the kind of step that makes a product feel as though
   * it requires an AWS expert.
   *
   * It is still saved and still validated: the account and the role name are checked before it is
   * stored, and only the permission test can say whether the role is really there.
   */
  // Reached only for an AWS connection: the sections above it are rendered for one.
  const expected = roleArnFor(view.awsAccountId ?? '', view.id, partitionOf(view.regions[0]));

  return (
    <SectionCard step={3} title={t('roleArnTitle')} description={t('roleArnHelp')} contentClassName="space-y-4">
        <RoleArnForm action={saveRoleArnAction.bind(null, locale, view.id)} defaultValue={view.roleArn ?? expected} />
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">{t('roleArnVerify')}</summary>
          <p className="mt-2 mb-2 text-xs text-muted-foreground">{t('roleArnVerifyHint')}</p>
          <CodeBlock value={roleArnCommand(view.id, view.regions[0])} />
        </details>
    </SectionCard>
  );
}
