import { getTranslations } from 'next-intl/server';
import { LOG_GROUP_SEARCH_LIMIT, searchLogGroups } from '@/lib/monitoring/logs';
import { resolveTarget } from '@/lib/monitoring/target';
import { toggleLogGroupAction } from './actions';
import { LogGroupToggle } from './forms';

/**
 * The log groups an operator may start forwarding.
 *
 * **Never a "forward everything" control.** Subscribing an account's every log group is the mistake this
 * whole surface is arranged to make impossible to commit by accident, so the only thing on offer is one
 * group at a time, each with its own button.
 *
 * The list is read from AWS when the page renders. It is one `DescribeLogGroups` call, which costs
 * nothing, and it is bounded — an account with thousands of groups gets the first page and a sentence
 * saying so rather than a scroll nobody reaches the end of.
 */
export async function LogGroupPicker({
  connectionId,
  region,
  locale,
  already,
  enabled,
}: {
  connectionId: string;
  region: string;
  locale: string;
  already: string[];
  enabled: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'Collection' });
  const target = await resolveTarget({ connectionId, region });
  if (!target.ok) return <p className="text-sm text-muted-foreground">{t('groups.unavailable')}</p>;

  const groups = await searchLogGroups(target.data, '');
  if (!groups.ok) return <p className="text-sm text-muted-foreground">{t('groups.unavailable')}</p>;

  const offered = groups.data.filter((group) => !already.includes(group.name));
  if (offered.length === 0) return <p className="text-sm text-muted-foreground">{t('groups.noneLeft')}</p>;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('groups.available')}</p>
      <ul className="max-h-64 overflow-y-auto rounded-md border px-3">
        {offered.map((group) => (
          <LogGroupToggle
            key={group.name}
            logGroup={group.name}
            active={false}
            failure={null}
            disabled={!enabled}
            onToggle={toggleLogGroupAction.bind(null, locale, connectionId, region, group.name, true)}
          />
        ))}
      </ul>
      {groups.data.length === LOG_GROUP_SEARCH_LIMIT && (
        <p className="text-xs text-muted-foreground">{t('groups.truncated', { count: LOG_GROUP_SEARCH_LIMIT })}</p>
      )}
    </div>
  );
}
