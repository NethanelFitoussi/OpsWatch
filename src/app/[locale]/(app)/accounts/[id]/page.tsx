import { ArrowLeft, Download, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ConnectionStatusBadge } from '@/components/connection-status-badge';
import { CopyButton } from '@/components/copy-button';
import { PermissionChecklist } from '@/components/permission-checklist';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { initProtectedRoute } from '@/lib/auth/route';
import { awsErrorCode } from '@/lib/aws/errors';
import { detectBaseIdentity, type CallerIdentity } from '@/lib/aws/identity';
import { identityErrorHint } from '@/lib/aws/identity-errors';
import { deployCommand, roleArnCommand } from '@/lib/aws/template';
import { ConnectionNotFoundError, getConnection, toView } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import {
  deleteConnectionAction,
  launchStackAction,
  regenerateExternalIdAction,
  saveAccessKeysAction,
  saveRoleArnAction,
} from '../actions';
import { AccessKeysForm, RoleArnForm } from './forms';
import { TestButton } from './test-button';

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string }>;
};

type IdentityLookup = { identity: CallerIdentity; errorCode?: never } | { identity: null; errorCode: string };

async function lookUpIdentity(region: string): Promise<IdentityLookup> {
  try {
    return { identity: await detectBaseIdentity(region) };
  } catch (error) {
    return { identity: null, errorCode: awsErrorCode(error) };
  }
}

async function IdentityErrorDetails({ code }: { code: string }) {
  const t = await getTranslations('IdentityErrors');
  const hint = identityErrorHint(code);
  return (
    <>
      <span className="mt-1 block">{t('title', { code })}</span>
      <span className="mt-1 block">{hint ? t(`hints.${hint}`) : t('hints.generic')}</span>
    </>
  );
}

function CodeBlock({ value }: { value: string }) {
  return (
    <div className="flex items-start gap-2">
      <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{value}</pre>
      <CopyButton value={value} />
    </div>
  );
}

export default async function ConnectionPage({ params, searchParams }: Props) {
  const { locale } = await initProtectedRoute(params);
  const { id } = await params;
  const { error } = await searchParams;

  let view;
  try {
    view = toView(getConnection(getDb(), id), env().OPSWATCH_SECRET);
  } catch (e) {
    if (e instanceof ConnectionNotFoundError) notFound();
    throw e;
  }

  const t = await getTranslations('AccountDetail');
  const tAccounts = await getTranslations('Accounts');
  const tChecklist = await getTranslations('Checklist');
  const region = view.regions[0];
  const lookup: IdentityLookup | null = view.method === 'keys' ? null : await lookUpIdentity(region);
  const identity = lookup?.identity ?? null;
  const ready = view.status !== 'draft';

  return (
    <div className="space-y-6">
      <Link href="/accounts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t('back')}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{view.name}</h1>
          <p className="text-muted-foreground">
            {tAccounts(`methods.${view.method}`)} · {t('accountLine', { account: view.awsAccountId, regions: view.regions.join(', ') })}
          </p>
        </div>
        <ConnectionStatusBadge status={view.status} />
      </div>

      {view.method === 'role' && (
        <>
          <Card>
            <CardHeader>
              <CardTitle><h2><span aria-hidden>① </span>{t('role.identityTitle')}</h2></CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {identity ? (
                <p>{t('role.identityDetected', { arn: identity.arn })}</p>
              ) : (
                <Alert variant="destructive">
                  <AlertDescription>
                    <span className="block">
                      {t('role.identityMissing')}{' '}
                      <Link href="/getting-started#step-0" className="underline">{t('role.guideLink')}</Link>
                    </span>
                    {lookup?.errorCode && <IdentityErrorDetails code={lookup.errorCode} />}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle><h2><span aria-hidden>② </span>{t('role.deployTitle')}</h2></CardTitle>
              <CardDescription>{t('role.deployHelp', { account: view.awsAccountId })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {view.templateOutdated && (
                <Alert><AlertDescription>{t('role.outdated')}</AlertDescription></Alert>
              )}
              {error === 'no_base_identity' && (
                <Alert variant="destructive"><AlertDescription>{t('role.noBaseIdentity')}</AlertDescription></Alert>
              )}
              {error === 'launch_failed' && (
                <Alert variant="destructive"><AlertDescription>{t('role.launchFailed')}</AlertDescription></Alert>
              )}
              <div>
                <p className="mb-1 text-sm font-medium">{t('role.externalIdTitle')}</p>
                <p className="mb-2 text-xs text-muted-foreground">{t('role.externalIdHelp')}</p>
                <CodeBlock value={view.externalId ?? ''} />
              </div>
              <div className="flex flex-wrap gap-2">
                {identity ? (
                  <Button asChild>
                    <a href={`/api/connections/${view.id}/template`}>
                      <Download className="size-4" aria-hidden /> {t('role.download')}
                    </a>
                  </Button>
                ) : (
                  <>
                    <Button type="button" disabled aria-describedby="download-unavailable">
                      <Download className="size-4" aria-hidden /> {t('role.download')}
                    </Button>
                    <p id="download-unavailable" className="self-center text-xs text-muted-foreground">
                      {t('role.downloadUnavailable')}
                    </p>
                  </>
                )}
                {env().OPSWATCH_TEMPLATE_BUCKET && identity && (
                  <form action={launchStackAction.bind(null, locale, view.id)}>
                    <Button type="submit" variant="outline">
                      <ExternalLink className="size-4" aria-hidden /> {t('role.launchStack')}
                    </Button>
                  </form>
                )}
              </div>
              <div>
                <p className="mb-2 text-sm">{t('role.cliLabel')}</p>
                <CodeBlock value={deployCommand(view.id, region)} />
              </div>
              <form action={regenerateExternalIdAction.bind(null, locale, view.id)} className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="ghost" size="sm">
                  <RefreshCw className="size-4" aria-hidden /> {t('role.regenerate')}
                </Button>
                <span className="text-xs text-muted-foreground">{t('role.regenerateHelp')}</span>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle><h2><span aria-hidden>③ </span>{t('role.roleArnTitle')}</h2></CardTitle>
              <CardDescription>{t('role.roleArnHelp')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CodeBlock value={roleArnCommand(view.id, region)} />
              <RoleArnForm action={saveRoleArnAction.bind(null, locale, view.id)} defaultValue={view.roleArn ?? ''} />
            </CardContent>
          </Card>
        </>
      )}

      {view.method === 'keys' && (
        <Card>
          <CardHeader>
            <CardTitle><h2>{t('keys.title')}</h2></CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert><AlertDescription>{t('keys.warning')}</AlertDescription></Alert>
            {view.accessKeyHint && <p className="text-sm">{t('keys.savedHint', { hint: view.accessKeyHint })}</p>}
            {view.keysUnreadable && (
              <Alert variant="destructive"><AlertDescription>{t('keys.unreadable')}</AlertDescription></Alert>
            )}
            <AccessKeysForm action={saveAccessKeysAction.bind(null, locale, view.id)} />
          </CardContent>
        </Card>
      )}

      {view.method === 'ambient' && (
        <Card>
          <CardHeader>
            <CardTitle><h2>{t('ambient.title')}</h2></CardTitle>
            <CardDescription>{t('ambient.description')}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {identity ? <p>{t('ambient.detected', { arn: identity.arn })}</p> : (
              <Alert variant="destructive">
                <AlertDescription>
                  <span className="block">{t('ambient.missing')}</span>
                  {lookup?.errorCode && <IdentityErrorDetails code={lookup.errorCode} />}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle><h2>{tChecklist('title')}</h2></CardTitle>
          {ready && <TestButton connectionId={view.id} />}
        </CardHeader>
        <CardContent>
          <PermissionChecklist result={view.lastTest} account={view.awsAccountId} />
        </CardContent>
      </Card>

      <Card className="border-red-200 dark:border-red-900">
        <CardHeader>
          <CardTitle><h2>{t('danger.title')}</h2></CardTitle>
          <CardDescription>{t('danger.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={deleteConnectionAction.bind(null, locale, view.id)}>
            <Button type="submit" variant="destructive">
              <Trash2 className="size-4" aria-hidden /> {t('danger.delete')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
