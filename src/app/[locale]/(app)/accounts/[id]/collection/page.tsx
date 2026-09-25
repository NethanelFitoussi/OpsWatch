import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { CodeBlock } from '@/components/code-block';
import { DocLink } from '@/components/docs/doc-link';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { deadLetterQueueUrl, deleteCollectionCommand, deployCollectionCommand } from '@/lib/aws/collection-template';
import { describeDeadLetters } from '@/lib/aws/forwarder-health';
import { resolveTarget } from '@/lib/monitoring/target';
import { findConnection } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { FORWARDER_VERSION } from '@/lib/ingest/forwarder-version';
import { forwarderState } from '@/lib/monitoring/shared/forwarder-state';
import { formatMetricValue } from '@/lib/monitoring/shared/format';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { listForwardedGroups, listStacks, readCollection, readIngestTraffic, readStack } from '@/lib/store/collection';
import { STATE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';
import {
  disableCollectionAction,
  enableCollectionAction,
  rotateSecretAction,
  saveCollectionSettingsAction,
  toggleLogGroupAction,
  verifyForwarderAction,
} from './actions';
import { CollectionSettingsForm, DisableCollectionForm, EnableCollectionForm, LogGroupToggle, RotateSecretForm, VerifyForwarderForm } from './forms';
import { LogGroupPicker } from './picker';

type Props = { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ region?: string }> };

export const generateMetadata = localizedTitle('Collection.metaTitle');

/** The window the forwarder's traffic is read over. An hour: long enough to be quiet, short enough to be now. */
const TRAFFIC_WINDOW_MS = 60 * 60_000;

/**
 * Managed collection, for one AWS account.
 *
 * The page is arranged around the decision rather than around the infrastructure: what mode this account
 * is in, what that means for where data goes, and only then the machinery. An operator should be able to
 * read the first card and know whether anything is leaving their AWS account.
 *
 * Nothing here is reachable without managed collection already being a deliberate choice: the page's
 * first state is an explanation and a confirmation, not a switch.
 */
/** The queue's depth, or null when it could not be read. Failure is not emptiness. */
async function readDeadLetters(connectionId: string, region: string, awsAccountId: string): Promise<number | null> {
  const target = await resolveTarget({ connectionId, region });
  if (!target.ok) return null;
  const depth = await describeDeadLetters(target.data, deadLetterQueueUrl(connectionId, region, awsAccountId));
  return depth.ok ? depth.data : null;
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const { locale } = await initProtectedRoute(params);
  const { id } = await params;
  const db = getDb();
  const row = findConnection(db, id);
  if (!row) notFound();

  const t = await getTranslations('Collection');
  const format = await getFormatter();
  const collection = readCollection(db, row.id);
  const nowMs = pageNow();
  const traffic = readIngestTraffic(db, row.id, nowMs - TRAFFIC_WINDOW_MS);
  const publicUrl = env().OPSWATCH_PUBLIC_URL?.replace(/\/$/, '');
  /*
   * The region being set up, and every region of this account beside it.
   *
   * A subscription filter can only target a Lambda in its own region, so a stack is installed per
   * region and each one is verified separately. The page works on one at a time — installing three
   * stacks is three passes through the same steps — and the picker says which of them are already
   * forwarding, so "is production covered" is answerable without opening each in turn.
   */
  const asked = (await searchParams).region;
  const region = row.regions.includes(asked ?? '') ? (asked as string) : (row.regions[0] ?? 'us-east-1');
  const stack = readStack(db, row.id, region);
  const stacks = new Map(listStacks(db, row.id).map((one) => [one.region, one]));
  const groups = listForwardedGroups(db, row.id, region);

  // The one number OpsWatch cannot know from its own counters: a batch that never arrived left no trace
  // here. Read only once this region's stack is verified, so a region with none makes no AWS call.
  const deadLetters = stack.stackState === 'verified' ? await readDeadLetters(row.id, region, row.awsAccountId) : null;

  const state = forwarderState({
    managed: collection.managed,
    verified: stack.stackState === 'verified',
    activeGroups: groups.filter((group) => group.state === 'active').length,
    events: traffic.events,
    rejected: traffic.rejected,
    // Null is "not measured" — a queue OpsWatch could not read is not a queue known to be empty.
    deadLetters,
  });

  return (
    <PageBody>
      <Link href={`/accounts/${row.id}`} className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t('back')}
      </Link>
      <PageHeader title={t('title', { name: row.name })} description={t('description')} />

      {/* First, and unmissable: which mode, and where the data goes. */}
      <SectionCard title={t('mode.title')} description={t('mode.hint')}>
        <div className="space-y-3">
          <p className="text-sm">
            <strong className="font-medium">{collection.managed ? t('mode.managed') : t('mode.direct')}</strong>
            <span className="block text-muted-foreground">{collection.managed ? t('mode.managedHint') : t('mode.directHint')}</span>
          </p>
          <dl className="text-sm">
            <dt className="text-muted-foreground">{t('mode.destination')}</dt>
            <dd className="font-mono text-xs break-all">
              {/* Never "OpsWatch Cloud": this product is self-hosted and the destination is the operator's
                  own instance, by URL, so the answer to "where does my data go" is on the page. */}
              {collection.managed ? (publicUrl ?? t('mode.noDestination')) : t('mode.destinationDirect')}
            </dd>
          </dl>
        </div>
      </SectionCard>

      {!collection.managed ? (
        <SectionCard title={t('enable.title')} description={t('enable.hint')}>
          <EnableCollectionForm action={enableCollectionAction.bind(null, locale, row.id)} canEnable={publicUrl !== undefined && publicUrl.length > 0} />
        </SectionCard>
      ) : (
        <>
          {/* Which region is being set up, and what every other one is doing. Only when there is a
              choice to make: one region is not a picker, it is a sentence the steps already say. */}
          {row.regions.length > 1 && (
            <SectionCard title={t('regions.title')} description={t('regions.hint')}>
              <div className="flex flex-wrap gap-2">
                {row.regions.map((one) => {
                  const verified = stacks.get(one)?.stackState === 'verified';
                  const current = one === region;
                  return (
                    <Link
                      key={one}
                      href={{ pathname: `/accounts/${row.id}/collection`, query: { region: one } }}
                      aria-current={current ? 'page' : undefined}
                      className={cn(
                        'rounded-full border px-3 py-1 text-sm',
                        current ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      {one}
                      {/* Forwarding and not forwarding, never left to be inferred from the absence of
                          a mark — and "not set up" is not "broken". */}
                      <span className={cn('ml-2 text-xs', verified ? STATE_TEXT.healthy : 'text-muted-foreground')}>
                        {verified ? t('regions.forwarding') : t('regions.notSetUp')}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </SectionCard>
          )}

          <SectionCard title={t('install.title')} description={t('install.hint')}>
            <ol className="list-decimal space-y-3 pl-5 text-sm">
              <li>
                {t('install.download')}{' '}
                <a href={`/api/connections/${row.id}/collection-template`} download className="underline underline-offset-4">
                  {t('install.downloadLink')}
                </a>
              </li>
              <li>
                {t('install.deploy', { region })}
                <div className="mt-2">
                  <CodeBlock value={deployCollectionCommand(row.id, region)} />
                </div>
                {/* A stack per region, because a subscription filter can only reach a Lambda in its
                    own region. Each region's state is on the chip, so an operator can see which are
                    covered without opening each one. */}
                {row.regions.length > 1 && (
                  <p className="mt-3 text-sm text-muted-foreground">{t('install.perRegion')}</p>
                )}
              </li>
              <li>{t('install.verifyStep')}</li>
            </ol>
            <p className="mt-3 text-sm text-muted-foreground">{t('install.noSecretInTemplate')}</p>
          </SectionCard>

          <SectionCard title={t('forwarder.title')} description={t('forwarder.hint')}>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t('forwarder.state')}</dt>
                <dd className={cn(state === 'healthy' ? STATE_TEXT.healthy : state === 'error' || state === 'degraded' ? STATE_TEXT.critical : STATE_TEXT.unknown)}>
                  {t(`states.${state}`)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('forwarder.version')}</dt>
                <dd>
                  {stack.forwarderVersion ?? t('forwarder.unknownVersion')}
                  {stack.forwarderVersion !== null && stack.forwarderVersion !== FORWARDER_VERSION && (
                    <span className="ml-2 text-xs text-muted-foreground">{t('forwarder.available', { version: FORWARDER_VERSION })}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('forwarder.lastEvent')}</dt>
                {/* Never having heard anything is not a failure, and the word for it is not a time. */}
                <dd>{traffic.lastEventAt === null ? t('forwarder.never') : format.relativeTime(new Date(traffic.lastEventAt))}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('forwarder.deadLetters')}</dt>
                <dd>{deadLetters === null ? t('forwarder.deadLettersUnknown') : t('forwarder.deadLettersCount', { count: deadLetters })}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('forwarder.hour')}</dt>
                <dd className="tabular-nums">
                  {t('forwarder.counts', { events: traffic.events, rejected: traffic.rejected, duplicates: traffic.duplicates })}
                  <span className="block text-xs text-muted-foreground">{formatMetricValue(traffic.bytes, 'bytes', locale)}</span>
                </dd>
              </div>
            </dl>
            <div className="mt-4 border-t pt-4">
              <VerifyForwarderForm action={verifyForwarderAction.bind(null, locale, row.id, region)} current={stack.forwarderArn} />
            </div>
            <div className="mt-4 border-t pt-4">
              <RotateSecretForm action={rotateSecretAction.bind(null, locale, row.id)} />
            </div>
          </SectionCard>

          <SectionCard title={t('settings.title')} description={t('settings.hint')}>
            <CollectionSettingsForm
              action={saveCollectionSettingsAction.bind(null, locale, row.id)}
              settings={{ realtimeLogs: collection.realtimeLogs, persistLogs: collection.persistLogs, retentionHours: collection.retentionHours }}
            />
          </SectionCard>

          <SectionCard title={t('groups.title')} description={t('groups.hint')}>
            {!collection.realtimeLogs && <p className="mb-3 text-sm text-muted-foreground">{t('groups.sourceOff')}</p>}
            {groups.length > 0 && (
              <ul className="mb-4">
                {groups.map((group) => (
                  <LogGroupToggle
                    key={group.id}
                    logGroup={group.logGroup}
                    active={group.state === 'active'}
                    failure={group.lastError}
                    disabled={!collection.realtimeLogs}
                    onToggle={toggleLogGroupAction.bind(null, locale, row.id, group.region, group.logGroup, group.state !== 'active')}
                  />
                ))}
              </ul>
            )}
            <LogGroupPicker
              connectionId={row.id}
              region={region}
              locale={locale}
              already={groups.map((group) => group.logGroup)}
              enabled={collection.realtimeLogs}
            />
            {/* §16: what AWS may charge for, in usage terms rather than in invented dollars. */}
            <p className="mt-4 text-sm text-muted-foreground">{t('groups.costs')}</p>
          </SectionCard>

          <SectionCard title={t('disable.title')} description={t('disable.hint')}>
            <DisableCollectionForm action={disableCollectionAction.bind(null, locale, row.id)} />
            <div className="mt-4 border-t pt-4">
              <p className="text-sm text-muted-foreground">{t('disable.stack')}</p>
              <div className="mt-2">
                <CodeBlock value={deleteCollectionCommand(row.id, region)} />
              </div>
            </div>
          </SectionCard>
        </>
      )}

      <p className="text-sm">
        <DocLink slug="push-collection" label={t('readGuide')} />
      </p>
    </PageBody>
  );
}
