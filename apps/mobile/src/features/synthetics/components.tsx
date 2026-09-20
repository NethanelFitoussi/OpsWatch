/**
 * Synthetics list row, summary line and the sections of the synthetic detail screen.
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { SyntheticDetail, SyntheticSummary } from '@/api/contract';
import { RichRow, StatusBadge, TimedItem } from '@/ui/rows';
import { FavoriteButton } from '@/features/shared/components';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { formatDateTime, formatMetric, formatPercentFraction } from '@/lib/format';
import { Badge } from '@/ui/badges';
import { UptimeBar } from '@/ui/charts';
import { KeyValue } from '@/ui/layout';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { classifySsl, sslMessage, sslNeedsAttention, sslTone, summaryParts, syntheticStatusMeta, targetHost, worstStatus, type SslState } from './helpers';

export function useSyntheticStatus() {
  const { t } = useI18n();
  return (status: SyntheticSummary['status']) => {
    const meta = syntheticStatusMeta(status);
    return { ...meta, label: t(meta.label) };
  };
}

export function SslBadge({ state, testID }: { state: SslState; testID?: string }) {
  const { t } = useI18n();
  const message = sslMessage(state);
  return <Badge tone={sslTone(state.level)} icon={state.level === 'ok' ? 'lock-closed' : 'lock-open'} label={t(message.key, message.params)} testID={testID} />;
}

/** "1 down · 1 degraded · 2 up": what is failing comes first, and the words carry it without the colour. */
export function SyntheticsSummary({ items }: { items: SyntheticSummary[] }) {
  const { t } = useI18n();
  const worst = worstStatus(items);
  const text = summaryParts(items)
    .map((part) => t(`synthetics.summary.${part.status}`, { count: part.count }))
    .join(' · ');
  return (
    <View style={styles.summary} accessible accessibilityRole="summary" testID="synthetics-summary">
      <Text variant="body" weight="700" tone={worst === 'down' ? 'critical' : worst === 'degraded' ? 'warning' : 'default'} style={styles.figures}>
        {text}
      </Text>
    </View>
  );
}

export const SyntheticRow = memo(function SyntheticRow({ synthetic, now }: { synthetic: SyntheticSummary; now: number }) {
  const { t } = useI18n();
  const openRef = useOpenRef();
  const status = useSyntheticStatus()(synthetic.status);
  const ssl = classifySsl(synthetic.ssl, now);
  const flagSsl = sslNeedsAttention(ssl);
  const meta = `${synthetic.kind.toUpperCase()} · ${targetHost(synthetic.target)}`;
  const availability = synthetic.availability24h === null ? t('metric.noData') : formatPercentFraction(synthetic.availability24h);
  const latency = synthetic.latencyMs === null ? t('metric.noData') : formatMetric(synthetic.latencyMs, 'ms');
  // A check that has never run has no availability to average: say that, rather than two "No data" figures.
  const detail =
    synthetic.lastCheckedAt === null
      ? t('synthetics.neverRun')
      : `${t('synthetics.availability24hShort', { value: availability })} · ${t('synthetics.latencyShort', { value: latency })}`;
  const sslText = flagSsl ? t(sslMessage(ssl).key, sslMessage(ssl).params) : null;
  return (
    <RichRow
      testID={`synthetic-row-${synthetic.id}`}
      title={synthetic.name}
      meta={meta}
      detail={detail}
      left={<StatusBadge meta={status} />}
      right={<FavoriteButton favorite={{ type: 'synthetic', id: synthetic.id, label: synthetic.name }} />}
      extra={flagSsl ? <View style={styles.sslFlag}><SslBadge state={ssl} testID={`synthetic-ssl-${synthetic.id}`} /></View> : null}
      onPress={() => openRef({ type: 'synthetic', id: synthetic.id })}
      accessibilityLabel={[status.label, synthetic.name, meta, detail, sslText].filter(Boolean).join(', ')}
    />
  );
});

export function SslBlock({ ssl, now }: { ssl: SyntheticSummary['ssl']; now: number }) {
  const { t, locale } = useI18n();
  const state = classifySsl(ssl, now);
  const validity = ssl?.valid === true ? t('synthetics.ssl.valid') : ssl?.valid === false ? t('synthetics.ssl.invalid') : t('health.unknown');
  return (
    <View style={styles.block} testID="synthetic-ssl">
      <SslBadge state={state} />
      <KeyValue label={t('synthetics.ssl.validity')} value={validity} />
      <KeyValue label={t('synthetics.ssl.issuer')} value={ssl?.issuer ?? t('state.noData')} />
      <KeyValue label={t('synthetics.ssl.expires')} value={ssl?.expiresAt ? formatDateTime(ssl.expiresAt, locale) : t('state.noData')} />
    </View>
  );
}

export function AvailabilityStrip({ buckets }: { buckets: SyntheticDetail['availability'] }) {
  const { t } = useI18n();
  if (!buckets.length) {
    return (
      <Text variant="small" tone="muted">
        {t('state.noData')}
      </Text>
    );
  }
  return (
    <View style={styles.block}>
      <UptimeBar buckets={buckets} />
      <Text variant="caption" tone="muted">
        {t('synthetics.uptimeLegend')}
      </Text>
    </View>
  );
}

export function FailureList({ failures }: { failures: SyntheticDetail['failures'] }) {
  const { t, locale } = useI18n();
  if (!failures.length) {
    return (
      <Text variant="small" tone="muted">
        {t('synthetics.noFailures')}
      </Text>
    );
  }
  const newestFirst = [...failures].sort((a, b) => b.at - a.at);
  return (
    <View testID="synthetic-failures">
      {newestFirst.map((failure, i) => (
        <TimedItem key={`${failure.at}-${i}`} time={formatDateTime(failure.at, locale)}>
          <Text variant="small" weight="600">
            {failure.reason}
          </Text>
          <Text variant="caption" tone="muted">
            {[failure.statusCode !== undefined ? t('synthetics.statusCode', { code: failure.statusCode }) : null, failure.location].filter(Boolean).join(' · ')}
          </Text>
        </TimedItem>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { paddingHorizontal: spacing.lg },
  figures: { fontVariant: ['tabular-nums'] },
  sslFlag: { marginTop: spacing.xs },
  block: { gap: spacing.sm },
});
