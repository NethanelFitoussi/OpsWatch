import { ExternalLink, Trash2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { CodeBlock } from '@/components/code-block';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/section-card';
import type { AppLocale } from '@/i18n/routing';
import { deleteCollectionCommand } from '@/lib/aws/collection-template';
import { deleteStackCommand, stacksConsoleUrl } from '@/lib/aws/template';
import { TONE_BORDER } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';
import { deleteConnectionAction } from '../../actions';

/**
 * Disconnecting an account, with what it actually does written out first — and what it cannot do.
 *
 * Two halves, and the product is only responsible for one of them.
 *
 * **What OpsWatch does**: stops reading, deletes the stored role details and encrypted credentials, and
 * removes everything this connection produced — its problems, alerts, error groups, deployments, log
 * sources, saved searches and history. That last part is new and is why the list says it: somebody who
 * expected "forget the credential" and got "forget six months of history" was told afterwards.
 *
 * **What OpsWatch cannot do**: delete anything in AWS. Its role is read-only, which is the entire point
 * of the role, so it could not remove its own stack even if that were wise. Rather than a button that
 * cannot work, the exact stack names, the console for the right region and the documented `delete-stack`
 * commands are here — and the collection stack comes first, because it holds the subscription filters.
 *
 * `managed` is passed in rather than read here because it changes both lists.
 */
export async function DangerZone({
  connectionId,
  locale,
  region,
  managed = false,
}: {
  connectionId: string;
  locale: AppLocale;
  region: string;
  managed?: boolean;
}) {
  const t = await getTranslations('AccountDetail.danger');
  return (
    <SectionCard
      title={t('title')}
      description={t('description')}
      className={cn('ring-0 border', TONE_BORDER.danger)}
      action={
        <form action={deleteConnectionAction.bind(null, locale, connectionId)}>
          <Button type="submit" variant="destructive">
            <Trash2 className="size-4" aria-hidden /> {t('delete')}
          </Button>
        </form>
      }
      contentClassName="space-y-4"
    >
      <div>
        <p className="text-sm font-medium">{t('opswatchDoes')}</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t('stopsCollection')}</li>
          <li>{t('removesCredentials')}</li>
          {/* The one that surprises people, so it is not last and it is not muted. */}
          <li className="font-medium text-foreground">{t('removesHistory')}</li>
          {managed && <li className="font-medium text-foreground">{t('stopsForwarding')}</li>}
        </ul>
      </div>

      <div>
        <p className="text-sm font-medium">{t('awsKeeps')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('cannotDelete')}</p>
        <div className="mt-3 space-y-3">
          {managed && (
            <div>
              {/* First: it holds the subscription filters that invoke the forwarder. */}
              <p className="mb-1 text-sm">{t('collectionStackFirst')}</p>
              <CodeBlock value={deleteCollectionCommand(connectionId, region)} />
            </div>
          )}
          <div>
            <p className="mb-1 text-sm">{t('baseStack')}</p>
            <CodeBlock value={deleteStackCommand(connectionId, region)} />
          </div>
        </div>
        <p className="mt-3">
          <a
            href={stacksConsoleUrl(region)}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('openConsole', { region })} <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </p>
      </div>
    </SectionCard>
  );
}
