/**
 * One log entry: when, how bad, where from, the full line and the objects it links to.
 */
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import type { LogEntry } from '@/api/contract';
import { DetailCard } from '@/features/shared/components';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { LogBlock } from '@/ui/code';
import { Button } from '@/ui/controls';
import { Card, Divider, KeyValue, Row, Section, type IconName } from '@/ui/layout';
import { EmptyState } from '@/ui/states';
import type { MessageKey } from '@/i18n';
import { spacing } from '@/ui/theme';
import { LevelBadge } from './components';
import { formatLogTimestamp } from './helpers';

export function LogNotFound() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <EmptyState
      icon="document-text-outline"
      title={t('logs.notFoundTitle')}
      body={t('logs.notFoundBody')}
      action={<Button label={t('logs.backToSearch')} icon="search" onPress={() => router.replace('/logs')} testID="logs-back-to-search" />}
    />
  );
}

type LinkSpec = { type: 'error' | 'problem' | 'service'; id: string; title: MessageKey; icon: IconName };

/** Log → Error → Problem → Service, in that order, only for the links the server provided. */
export function logLinks(entry: LogEntry): LinkSpec[] {
  const links = entry.links ?? {};
  const out: LinkSpec[] = [];
  if (links.errorId) out.push({ type: 'error', id: links.errorId, title: 'logs.link.error', icon: 'bug-outline' });
  if (links.problemId) out.push({ type: 'problem', id: links.problemId, title: 'logs.link.problem', icon: 'flame-outline' });
  if (links.serviceId) out.push({ type: 'service', id: links.serviceId, title: 'logs.link.service', icon: 'server-outline' });
  return out;
}

export function LogEntryDetail({ entry }: { entry: LogEntry }) {
  const { t } = useI18n();
  const openRef = useOpenRef();
  const links = logLinks(entry);
  // Sorted, so the same field is in the same place on every entry when comparing two lines during an incident.
  const fields = Object.entries(entry.fields ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const noData = t('state.noData');
  return (
    <>
      <DetailCard>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <LevelBadge level={entry.level} />
        </View>
        <KeyValue label={t('logs.timestamp')} value={formatLogTimestamp(entry.timestamp)} mono />
        <KeyValue label={t('logs.utc')} value={new Date(entry.timestamp).toISOString()} mono />
        <KeyValue label={t('filter.service')} value={entry.service ?? noData} />
        <KeyValue label={t('logs.source')} value={entry.source ?? noData} mono={!!entry.source} />
      </DetailCard>

      <Section title={t('logs.message')}>
        <View testID="log-message">
          <LogBlock message={entry.message} />
        </View>
      </Section>

      {fields.length ? (
        <Section title={t('logs.fields')}>
          <DetailCard>
            {fields.map(([key, value]) => (
              <KeyValue key={key} label={key} value={value} mono />
            ))}
          </DetailCard>
        </Section>
      ) : null}

      {links.length ? (
        <Section title={t('logs.related')}>
          <Card padded={false}>
            {links.map((link, i) => (
              <View key={link.type}>
                {i > 0 ? <Divider /> : null}
                <Row title={t(link.title)} subtitle={link.id} icon={link.icon} onPress={() => openRef({ type: link.type, id: link.id })} testID={`log-link-${link.type}`} />
              </View>
            ))}
          </Card>
        </Section>
      ) : null}
    </>
  );
}
