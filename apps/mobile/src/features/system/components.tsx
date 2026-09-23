/**
 * The System status screen: whether OpsWatch itself is collecting, and what that means for the rest of the app.
 *
 * The verdict comes first and takes the whole width, because it is the only thing most people open this screen for.
 * The detail underneath is for the person who has just learned that something is wrong and now wants to know what.
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { EnvironmentStatus, JobStatus, SystemStatus } from '@/api/contract';
import { useI18n, type MessageKey } from '@/i18n';
import { formatBytes, formatDuration } from '@/lib/format';
import { Badge } from '@/ui/badges';
import { Card, KeyValue, Section } from '@/ui/layout';
import { Text } from '@/ui/text';
import { spacing, toneColors } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';
import { useNow, useRelativeTime, useScheduledTime } from '@/ui/states';
import { collectorVerdict, environmentCoverage, isPartial, jobMeta, label, sortJobs } from './helpers';

/** The headline: one sentence of state, one sentence of consequence. */
export function CollectorVerdict({ status }: { status: SystemStatus }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const now = useNow();
  const relative = useRelativeTime();
  const verdict = collectorVerdict(status, now);
  const tint = toneColors(colors, verdict.tone).fg;

  return (
    <Card accent={tint} testID="system-verdict">
      <Text variant="caption" tone="muted" weight="700" style={styles.caption}>
        {t('system.subtitle')}
      </Text>
      <View style={styles.verdictLine}>
        <Badge tone={verdict.tone} icon={verdict.icon} label={t(verdict.title)} size="large" testID="system-verdict-badge" />
      </View>
      <Text tone="muted" testID="system-consequence">
        {t(verdict.consequence)}
      </Text>
      <View style={styles.facts}>
        <KeyValue
          label={t('system.heartbeat')}
          value={status.collector.heartbeatAt === null ? t('system.heartbeat.never') : relative(status.collector.heartbeatAt, now)}
        />
        {status.collector.owner === null ? null : <KeyValue label={t('system.owner')} value={label(status.collector.owner)} mono />}
      </View>
    </Card>
  );
}

/** One collection job: what it is for, when it last ran, when it runs next, and how it went. */
/**
 * When a job runs next. A run less than a minute away is "due" rather than "in 0 min" — and rather than "just now",
 * which is what a relative formatter produces for anything inside its own threshold and which reads, for a schedule,
 * as though it has already happened.
 */
function nextRunLabel(
  nextRunAt: number | null,
  now: number,
  t: (key: MessageKey, values?: Record<string, string>) => string,
  scheduled: (at: number, now: number) => string,
): string {
  if (nextRunAt === null) return t('system.job.nextRunUnknown');
  if (nextRunAt - now < 60_000) return t('system.job.nextRunDue');
  return t('system.job.nextRun', { time: scheduled(nextRunAt, now) });
}

export const JobRow = memo(function JobRow({ job }: { job: JobStatus }) {
  const { t } = useI18n();
  const now = useNow();
  const relative = useRelativeTime();
  const scheduled = useScheduledTime();
  const meta = jobMeta(job);
  const partial = isPartial(job);

  const when =
    job.lastRunAt === null
      ? t('system.job.every', { interval: formatDuration(job.everyMs) })
      : [
          t('system.job.lastRun', { time: relative(job.lastRunAt, now) }),
          job.durationMs === null ? null : t('system.job.took', { duration: formatDuration(job.durationMs) }),
          nextRunLabel(job.nextRunAt, now, t, scheduled),
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <View style={styles.job} testID={`system-job-${label(job.job)}`}>
      <View style={styles.jobHead}>
        <Text variant="body" weight="600" style={styles.jobName} numberOfLines={1}>
          {label(job.job)}
        </Text>
        <Badge tone={meta.tone} icon={meta.icon} label={t(meta.label)} testID={`system-job-state-${label(job.job)}`} />
      </View>
      <Text variant="small" tone="muted">
        {when}
      </Text>
      {job.errorCode === null ? null : (
        <Text variant="small" tone="critical" testID={`system-job-error-${label(job.job)}`}>
          {t('system.job.errorCode', { code: label(job.errorCode) })}
        </Text>
      )}
      {partial ? (
        <Text variant="small" tone="warning" testID={`system-job-partial-${label(job.job)}`}>
          {job.truncated
            ? t('system.job.truncated')
            : t('system.job.partial', { covered: String(job.covered), total: String(job.total) })}
        </Text>
      ) : null}
    </View>
  );
});

export function Jobs({ jobs }: { jobs: JobStatus[] }) {
  const { t } = useI18n();
  return (
    <Section title={t('system.jobs')}>
      <Card testID="system-jobs">
        {jobs.length === 0 ? (
          <Text tone="muted">{t('system.jobs.none')}</Text>
        ) : (
          sortJobs(jobs).map((job) => <JobRow key={job.job} job={job} />)
        )}
      </Card>
    </Section>
  );
}

/** How completely each environment was read. A partial read is why a screen can be missing things. */
export function Environments({ environments }: { environments: EnvironmentStatus[] }) {
  const { t } = useI18n();
  const now = useNow();
  const relative = useRelativeTime();

  return (
    <Section title={t('system.environments')}>
      <Card testID="system-environments">
        {environments.length === 0 ? (
          <Text tone="muted">{t('system.environments.none')}</Text>
        ) : (
          environments.map((environment) => {
            const coverage = environmentCoverage(environment.familiesRead, environment.familiesTotal);
            return (
              <View key={`${environment.connectionId}:${environment.scope}`} style={styles.job} testID={`system-env-${label(environment.scope)}`}>
                <Text variant="body" weight="600" numberOfLines={1}>
                  {label(environment.scope)}
                </Text>
                <Text variant="small" tone={coverage.complete ? 'muted' : 'warning'}>
                  {coverage.complete && coverage.fraction !== null
                    ? t('system.environment.readAll')
                    : t('system.environment.read', { read: String(environment.familiesRead), total: String(environment.familiesTotal) })}
                </Text>
                <Text variant="small" tone="muted">
                  {environment.lastReadAt === null
                    ? t('system.environment.neverRead')
                    : t('system.environment.lastRead', { time: relative(environment.lastReadAt, now) })}
                </Text>
              </View>
            );
          })
        )}
      </Card>
    </Section>
  );
}

export function About({ status }: { status: SystemStatus }) {
  const { t } = useI18n();
  return (
    <Section title={t('system.about')}>
      <Card testID="system-about">
        <KeyValue label={t('system.version')} value={status.version} mono />
        <KeyValue label={t('system.database')} value={status.database.sizeBytes === null ? '—' : formatBytes(status.database.sizeBytes)} />
        <KeyValue label={t('system.schema')} value={status.database.schemaVersion === null ? '—' : String(status.database.schemaVersion)} />
      </Card>
    </Section>
  );
}

const styles = StyleSheet.create({
  caption: { marginBottom: spacing.sm },
  verdictLine: { flexDirection: 'row', marginBottom: spacing.sm },
  facts: { marginTop: spacing.md, gap: 2 },
  job: { paddingVertical: spacing.sm, gap: 2 },
  jobHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  jobName: { flexShrink: 1 },
});
