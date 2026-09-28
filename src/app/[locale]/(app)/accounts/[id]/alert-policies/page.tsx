import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { findConnection } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { listAlertPolicies } from '@/lib/do/alerts';
import { doTargetFrom } from '@/lib/do/target';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ locale: string; id: string }> };

export const generateMetadata = localizedTitle('DoAlerts.title');

/**
 * What an operator asked DigitalOcean to tell them about.
 *
 * **Configuration, not state, and the page says so at the top.** DigitalOcean's Monitoring API has
 * five operations on alert policies and sixty metric endpoints, and none that returns which policies
 * are currently firing. Google has one, which is why a Google project has open incidents here and a
 * DigitalOcean account has none — not because OpsWatch has not got round to it.
 *
 * Saying that out loud is the whole value of the page. An operator comparing two clouds in this
 * product would otherwise read the empty DigitalOcean list as "nothing is wrong".
 */
export default async function DoAlertPoliciesPage({ params }: Props) {
  await initProtectedRoute(params);
  const { id } = await params;
  const db = getDb();
  const row = findConnection(db, id);
  if (row === null || row.provider !== 'do') notFound();

  const t = await getTranslations('DoAlerts');
  const target = doTargetFrom(row);
  const result = target.ok ? await listAlertPolicies({ target: target.data }) : null;
  const failure = target.ok ? (result !== null && !result.ok ? result.reason : null) : target.code === 'SecretChanged' ? 'secret_changed' : 'not_ready';
  const answered = result !== null && result.ok ? result : null;

  return (
    <PageBody>
      <Link href={`/accounts/${row.id}`} className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t('back')}
      </Link>
      <PageHeader title={t('title', { name: row.name })} description={t('description')} />

      <SectionCard title={t('listTitle')} description={t('listHint')}>
        {answered === null ? (
          <>
            <p className={cn('text-sm font-medium', TONE_TEXT.danger)}>{t(`failures.${failure ?? 'error'}`)}</p>
            <p className="mt-2 text-sm">
              <Link href={`/accounts/${row.id}`} className="text-primary underline-offset-4 hover:underline">
                {t('checkAccess')}
              </Link>
            </p>
          </>
        ) : answered.policies.length === 0 ? (
          // Not "nothing is wrong": nothing has been asked. The two are as different here as they are
          // on the Google page, and for the same reason.
          <>
            <p className="text-sm font-medium">{t('noneTitle')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('noneHint')}</p>
          </>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.policy')}</TableHead>
                <TableHead>{t('columns.condition')}</TableHead>
                <TableHead>{t('columns.applies')}</TableHead>
                <TableHead>{t('columns.state')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {answered.policies.map((policy) => (
                <TableRow key={policy.uuid}>
                  <TableCell className="font-medium">
                    <span className="block">{policy.description === '' ? t('unnamed') : policy.description}</span>
                    {/* DigitalOcean's own type string, which is what their console and API call it. */}
                    <span className="block font-mono text-xs text-muted-foreground">{policy.type}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {/* A threshold DigitalOcean did not send is unknown, never zero: "above 0 %" is a
                        different policy from one whose threshold nobody could read. */}
                    {policy.compare === null || policy.value === null
                      ? t('conditionUnknown')
                      : t('condition', { compare: t(`compare.${policy.compare}`), value: policy.value, window: policy.window ?? t('windowUnknown') })}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t('applies', { droplets: policy.entities, tags: policy.tags })}</TableCell>
                  <TableCell>
                    <span className={cn('text-sm font-medium', policy.enabled ? TONE_TEXT.success : 'text-muted-foreground')}>
                      {t(policy.enabled ? 'enabled' : 'disabled')}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
          {/*
            * The sentence this page exists for, shown whether or not the read worked. It is a fact
            * about DigitalOcean rather than about this request: an operator whose token was refused
            * still needs to know why there are no DigitalOcean incidents anywhere in this product.
            */}
          {/*
            * Said once rather than on every row: DigitalOcean offers a policy only for droplets that
            * run its agent, so "Enabled" above means enabled *for those*, and an operator who has not
            * installed it is not covered by anything on this page.
            */}
          <p>{t('needsAgent')}</p>
          <p>{t('noFiringState')}</p>
          {answered?.truncated === true && <p>{t('truncated')}</p>}
          {answered !== null && <p>{t('readNow')}</p>}
        </div>
      </SectionCard>
    </PageBody>
  );
}
