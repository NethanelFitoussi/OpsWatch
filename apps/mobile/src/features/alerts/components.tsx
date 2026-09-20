/**
 * Alert list row and the pieces of the alert detail screen.
 */
import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import type { AlertDetail, AlertSummary } from '@/api/contract';
import { useAcknowledgeAlert } from '@/api/queries';
import { useI18n } from '@/i18n';
import { formatDateTime, formatDuration } from '@/lib/format';
import { useOpenRef } from '@/features/shared/navigation';
import { SeverityBadge } from '@/ui/badges';
import { Button } from '@/ui/controls';
import { haptics } from '@/lib/haptics';
import { errorMessageKey, useNow, useRelativeTime } from '@/ui/states';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';
import { RichRow, StatusBadge, TimedItem } from '@/ui/rows';
import { alertDurationMs, alertStatusMeta, canAcknowledge, chronologicalHistory } from './helpers';

export function useAlertStatusMeta() {
  const { t } = useI18n();
  return (status: AlertSummary['status']) => {
    const meta = alertStatusMeta(status);
    return { ...meta, label: t(meta.label) };
  };
}

export const AlertRow = memo(function AlertRow({ alert, now }: { alert: AlertSummary; now: number }) {
  const { t } = useI18n();
  const openRef = useOpenRef();
  const relative = useRelativeTime();
  const status = t(alertStatusMeta(alert.status).label);
  const since = alert.since === null ? t('alerts.sinceUnknown') : t('time.since', { time: relative(alert.since, now) });
  const meta = [alert.service?.label ?? alert.service?.id, status, since].filter(Boolean).join(' · ');
  return (
    <RichRow
      testID={`alert-row-${alert.id}`}
      title={alert.name}
      meta={meta}
      detail={alert.reason}
      left={<SeverityBadge severity={alert.severity} />}
      onPress={() => openRef({ type: 'alert', id: alert.id })}
      accessibilityLabel={[t(`severity.${alert.severity}`), alert.name, meta, alert.reason].filter(Boolean).join(', ')}
    />
  );
});

/** Severity, status, name, source and how long it has been in this state. */
export function AlertHeader({ alert }: { alert: AlertDetail }) {
  const { t } = useI18n();
  const statusMeta = useAlertStatusMeta();
  const now = useNow();
  const relative = useRelativeTime();
  const duration = alertDurationMs(alert, now);
  return (
    <View style={styles.header}>
      <View style={styles.badges}>
        <SeverityBadge severity={alert.severity} />
        <StatusBadge meta={statusMeta(alert.status)} testID="alert-status" />
      </View>
      <Text variant="title" accessibilityRole="header" selectable>
        {alert.name}
      </Text>
      <Text variant="small" tone="muted">
        {[alert.source, alert.service?.label].filter(Boolean).join(' · ')}
      </Text>
      <Text variant="small" weight="600" testID="alert-since">
        {alert.since === null || duration === null
          ? t('alerts.sinceUnknown')
          : `${t('time.since', { time: relative(alert.since, now) })} · ${t('alerts.for', { duration: formatDuration(duration) })}`}
      </Text>
      {alert.reason ? <Text>{alert.reason}</Text> : null}
    </View>
  );
}

/**
 * Acknowledge, shown only when the server allows it. Loading, failure and success are visible and announced to
 * screen readers. Acknowledging only records that someone is looking; it changes nothing on the monitored system.
 */
export function AcknowledgeAction({ alert }: { alert: AlertDetail }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const acknowledge = useAcknowledgeAlert(alert.id);
  const allowed = canAcknowledge(alert) && !acknowledge.isSuccess;
  if (!allowed && !acknowledge.isSuccess) return null;
  return (
    <View style={styles.ack}>
      {allowed ? (
        <Button
          label={acknowledge.isPending ? t('alerts.acknowledging') : t('action.acknowledge')}
          icon="eye-outline"
          loading={acknowledge.isPending}
          accessibilityHint={t('alerts.acknowledgeHint')}
          testID="alert-acknowledge"
          onPress={() =>
            acknowledge.mutate(undefined, {
              onSuccess: () => {
                haptics.success();
                AccessibilityInfo.announceForAccessibility(t('alerts.acknowledgeSuccess'));
              },
              onError: (error) => {
                haptics.error();
                AccessibilityInfo.announceForAccessibility(t('alerts.acknowledgeFailed', { reason: t(errorMessageKey(error)) }));
              },
            })
          }
        />
      ) : null}
      {acknowledge.isSuccess ? (
        <View style={styles.feedback} accessibilityLiveRegion="polite" testID="alert-acknowledge-success">
          <Ionicons name="checkmark-circle" size={16} color={colors.healthy} importantForAccessibility="no" />
          <Text variant="small" tone="healthy" weight="600">
            {t('alerts.acknowledgeSuccess')}
          </Text>
        </View>
      ) : null}
      {acknowledge.isError ? (
        <View style={styles.feedback} accessibilityLiveRegion="polite" testID="alert-acknowledge-error">
          <Ionicons name="alert-circle" size={16} color={colors.critical} importantForAccessibility="no" />
          <Text variant="small" tone="critical" style={styles.flex}>
            {t('alerts.acknowledgeFailed', { reason: t(errorMessageKey(acknowledge.error)) })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Links to the problem, service and incident this alert belongs to. */
export function AlertLinks({ alert }: { alert: AlertDetail }) {
  const { t } = useI18n();
  const openRef = useOpenRef();
  const links = [
    alert.problemId ? { key: 'problem', label: t('action.openProblem'), icon: 'alert-circle-outline' as const, ref: { type: 'problem' as const, id: alert.problemId } } : null,
    alert.service ? { key: 'service', label: t('action.openService'), icon: 'apps-outline' as const, ref: alert.service } : null,
    alert.incidentId ? { key: 'incident', label: t('action.openIncident'), icon: 'flame-outline' as const, ref: { type: 'incident' as const, id: alert.incidentId } } : null,
  ].filter((l) => l !== null);
  if (!links.length) return null;
  return (
    <View style={styles.links}>
      {links.map((link) => (
        <Button key={link.key} label={link.label} icon={link.icon} variant="secondary" onPress={() => openRef(link.ref)} testID={`alert-open-${link.key}`} />
      ))}
    </View>
  );
}

export function AlertHistory({ history }: { history: AlertDetail['history'] }) {
  const { t, locale } = useI18n();
  const items = chronologicalHistory(history);
  if (!items.length) {
    return (
      <Text variant="small" tone="muted">
        {t('alerts.historyEmpty')}
      </Text>
    );
  }
  return (
    <View testID="alert-history">
      {items.map((entry, i) => (
        <TimedItem key={`${entry.at}-${i}`} time={formatDateTime(entry.at, locale)}>
          <Text variant="small" weight="700">
            {entry.status}
          </Text>
          {entry.reason ? (
            <Text variant="small" tone="muted">
              {entry.reason}
            </Text>
          ) : null}
        </TimedItem>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  ack: { gap: spacing.sm },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex: { flex: 1 },
  links: { gap: spacing.sm },
});
