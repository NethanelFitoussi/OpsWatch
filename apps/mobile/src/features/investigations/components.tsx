/**
 * Investigation and repository-evidence building blocks.
 */
import { StyleSheet, View } from 'react-native';
import type { Evidence, EvidenceKind, Investigation, RepositoryEvidence } from '@/api/contract';
import { EvidenceItem } from '@/features/shared/components';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { formatDateTime, shortSha } from '@/lib/format';
import { Badge } from '@/ui/badges';
import { Card, Divider, KeyValue, Row } from '@/ui/layout';
import { useNow, useRelativeTime } from '@/ui/states';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { KIND_ICONS, withDayBreaks } from './helpers';

export function KindTag({ kind }: { kind: EvidenceKind }) {
  const { t } = useI18n();
  // Hypotheses use the warning tone so they never read as established facts.
  return <Badge tone={kind === 'hypothesis' ? 'warning' : kind === 'correlation' ? 'info' : 'unknown'} icon={KIND_ICONS[kind]} label={t(`investigations.kind.${kind}`)} />;
}

/** The day a timeline entry belongs to, spelled out once per day: "Fri 19 Sep". */
function dayLabel(at: number, locale: string): string {
  return new Date(at).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * One chronological timeline of every evidence item, each tagged fact / correlation / hypothesis with icon and word,
 * and a date heading whenever the day changes so the clock times are never ambiguous.
 */
export function ChronologicalTimeline({ timeline, locale }: { timeline: Evidence[]; locale: string }) {
  return (
    <View style={styles.timeline} testID="investigation-timeline">
      {withDayBreaks(timeline, (at) => dayLabel(at, locale)).map(({ item, day }) => (
        <View key={item.id} style={styles.tagged}>
          {day ? (
            <View style={styles.day} testID={`timeline-day-${item.id}`}>
              <Text variant="label" tone="muted" accessibilityRole="header">
                {day.toUpperCase()}
              </Text>
            </View>
          ) : null}
          <View style={styles.tag}>
            <KindTag kind={item.kind} />
          </View>
          <EvidenceItem item={item} locale={locale} />
        </View>
      ))}
    </View>
  );
}

export function InvestigationHeader({ investigation }: { investigation: Investigation }) {
  const { t, locale } = useI18n();
  const openRef = useOpenRef();
  const now = useNow();
  const relative = useRelativeTime();
  const open = investigation.status === 'open';
  return (
    <Card>
      <View style={styles.gap}>
        <Badge tone={open ? 'info' : 'healthy'} icon={open ? 'search' : 'checkmark-done'} label={t(`investigations.status.${investigation.status}`)} testID="investigation-status" />
        <Text variant="title" accessibilityRole="header" testID="investigation-title">
          {investigation.title}
        </Text>
        <KeyValue label={t('investigations.started')} value={`${formatDateTime(investigation.startedAt, locale)} (${relative(investigation.startedAt, now)})`} />
      </View>
      <Divider />
      <View style={styles.bleed}>
        <Row
          title={investigation.subject.label ?? t(`investigations.open.${investigation.subject.type}`)}
          subtitle={t('investigations.subject')}
          icon="link-outline"
          onPress={() => openRef(investigation.subject)}
          testID="investigation-subject"
        />
      </View>
    </Card>
  );
}

export function CommitCard({ evidence }: { evidence: RepositoryEvidence }) {
  const { t, locale } = useI18n();
  const { commit } = evidence;
  return (
    <Card>
      <KeyValue label={t('evidence.repository')} value={evidence.repository} mono />
      {evidence.branch ? <KeyValue label={t('evidence.branch')} value={evidence.branch} mono /> : null}
      <KeyValue label={t('evidence.commit')} value={shortSha(commit.sha)} mono />
      {commit.message ? <KeyValue label={t('evidence.message')} value={commit.message} /> : null}
      {commit.author ? <KeyValue label={t('evidence.author')} value={commit.author} /> : null}
      {commit.at !== undefined ? <KeyValue label={t('evidence.committedAt')} value={formatDateTime(commit.at, locale)} /> : null}
      {evidence.file ? <KeyValue label={t('evidence.file')} value={evidence.file} mono /> : null}
      {evidence.lines ? <KeyValue label={t('evidence.linesLabel')} value={t('evidence.lines', evidence.lines)} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm, paddingBottom: spacing.sm },
  bleed: { marginHorizontal: -spacing.lg, marginBottom: -spacing.lg },
  timeline: { gap: spacing.sm },
  tagged: { gap: 4 },
  tag: { paddingLeft: 48 + spacing.sm },
  day: { paddingLeft: 48 + spacing.sm, paddingTop: spacing.sm },
});
