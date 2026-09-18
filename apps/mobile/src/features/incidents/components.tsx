/**
 * Incident list row and the sections of the incident detail screen.
 */
import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { IncidentDetail, IncidentSummary } from '@/api/contract';
import { RichRow, StatusBadge, TimedItem } from '@/ui/rows';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { formatClock, formatDateTime } from '@/lib/format';
import { SeverityBadge } from '@/ui/badges';
import { Card, Divider, KeyValue, Row } from '@/ui/layout';
import { useNow } from '@/ui/states';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';
import { chronological, incidentDurationText, incidentStatusMeta, serviceNames, timelineTypeKey } from './helpers';

export function useIncidentStatus() {
  const { t } = useI18n();
  return (status: IncidentSummary['status']) => {
    const meta = incidentStatusMeta(status);
    return { ...meta, label: t(meta.label) };
  };
}

export const IncidentRow = memo(function IncidentRow({ incident, now }: { incident: IncidentSummary; now: number }) {
  const { t } = useI18n();
  const openRef = useOpenRef();
  const duration = incidentDurationText(incident, now);
  const meta = `${t(incidentStatusMeta(incident.status).label)} · ${t(duration.key, duration.params)}`;
  const services = serviceNames(incident);
  return (
    <RichRow
      testID={`incident-row-${incident.id}`}
      title={incident.title}
      meta={meta}
      detail={services ? t('incidents.affected', { services }) : undefined}
      left={<SeverityBadge severity={incident.severity} />}
      onPress={() => openRef({ type: 'incident', id: incident.id })}
      accessibilityLabel={[t(`severity.${incident.severity}`), incident.title, meta, services].filter(Boolean).join(', ')}
    />
  );
});

export function IncidentHeader({ incident }: { incident: IncidentDetail }) {
  const { t, locale } = useI18n();
  const status = useIncidentStatus();
  const now = useNow();
  const duration = incidentDurationText(incident, now);
  return (
    <View style={styles.header}>
      <View style={styles.badges}>
        <SeverityBadge severity={incident.severity} />
        <StatusBadge meta={status(incident.status)} testID="incident-status" />
      </View>
      <Text variant="title" accessibilityRole="header" selectable>
        {incident.title}
      </Text>
      <Text variant="small" weight="600" testID="incident-duration">
        {t(duration.key, duration.params)}
      </Text>
      {incident.summary ? <Text>{incident.summary}</Text> : null}
      <View>
        <KeyValue label={t('incidents.started')} value={formatDateTime(incident.startedAt, locale)} />
        <KeyValue label={t('incidents.resolved')} value={incident.resolvedAt === null ? t('incidents.notResolved') : formatDateTime(incident.resolvedAt, locale)} />
      </View>
    </View>
  );
}

export function AffectedServices({ services }: { services: IncidentDetail['affectedServices'] }) {
  const openRef = useOpenRef();
  return (
    <Card padded={false}>
      {services.map((service, i) => (
        <View key={service.id}>
          {i > 0 ? <Divider /> : null}
          <Row title={service.label ?? service.id} icon="apps-outline" onPress={() => openRef(service)} testID={`incident-service-${service.id}`} />
        </View>
      ))}
    </Card>
  );
}

export function IncidentTimeline({ timeline }: { timeline: IncidentDetail['timeline'] }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const openRef = useOpenRef();
  const items = chronological(timeline);
  return (
    <View testID="incident-timeline" style={styles.list}>
      {items.map((entry, i) => {
        const typeKey = timelineTypeKey(entry.type);
        return (
          <TimedItem key={`${entry.at}-${i}`} time={formatClock(entry.at, locale)} testID={`incident-timeline-${i}`}>
            <Text variant="caption" tone="muted" weight="700">
              {(typeKey ? t(typeKey) : entry.type).toUpperCase()}
            </Text>
            <Text variant="small">{entry.text}</Text>
            {entry.ref ? (
              <Pressable onPress={() => openRef(entry.ref!)} accessibilityRole="link" style={styles.link} hitSlop={8}>
                <Text variant="small" weight="600" tone="primary">
                  {entry.ref.label ?? t('incidents.openRef')}
                </Text>
                <Ionicons name="arrow-forward" size={14} color={colors.primary} importantForAccessibility="no" />
              </Pressable>
            ) : null}
          </TimedItem>
        );
      })}
    </View>
  );
}

export function IncidentNotes({ notes }: { notes: IncidentDetail['notes'] }) {
  const { t, locale } = useI18n();
  return (
    <View style={styles.list} testID="incident-notes">
      {chronological(notes).map((note, i) => (
        <View key={`${note.at}-${i}`} style={styles.note}>
          <Text variant="caption" tone="muted" weight="700">
            {`${note.author ?? t('incidents.unknownAuthor')} · ${formatDateTime(note.at, locale)}`}
          </Text>
          <Text variant="small" selectable>
            {note.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  list: { gap: spacing.sm },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  note: { gap: 2 },
});
