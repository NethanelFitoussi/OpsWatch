/**
 * Deployment rows, status badge and the "problems that started after this deployment" block. Problems are linked to a
 * deployment by timing only; the wording never claims a cause.
 */
import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { DeploymentDetail, DeploymentSummary, RepositoryEvidence } from '@/api/contract';
import { ProblemRow } from '@/features/shared/components';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { shortSha } from '@/lib/format';
import { Badge } from '@/ui/badges';
import { Card, Divider, Row } from '@/ui/layout';
import { useNow, useRelativeTime } from '@/ui/states';
import { Text } from '@/ui/text';
import { radius, spacing, TOUCH_TARGET } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';
import { commitLine, DEPLOYMENT_STATUS_META, timingSentence, type DeploymentStatus } from './helpers';

export function DeploymentStatusBadge({ status, size }: { status: DeploymentStatus; size?: 'small' | 'large' }) {
  const { t } = useI18n();
  const meta = DEPLOYMENT_STATUS_META[status];
  return <Badge tone={meta.tone} icon={meta.icon} label={t(meta.label)} size={size} testID={`deployment-status-${status}`} />;
}

/** Service, version, environment, time, status and commit, in three short lines. */
export const DeploymentRow = memo(function DeploymentRow({ deployment, showService = true }: { deployment: DeploymentSummary; showService?: boolean }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const openRef = useOpenRef();
  const now = useNow();
  const relative = useRelativeTime();
  const title = showService ? `${deployment.service.label ?? deployment.service.id} ${deployment.version}` : deployment.version;
  const when = relative(deployment.at, now);
  const commit = commitLine(deployment.commit);
  return (
    <Pressable
      onPress={() => openRef({ type: 'deployment', id: deployment.id })}
      accessibilityRole="button"
      accessibilityLabel={[title, t(DEPLOYMENT_STATUS_META[deployment.status].label), deployment.environment, when, commit].filter(Boolean).join(', ')}
      testID={`deployment-row-${deployment.id}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
    >
      <View style={styles.top}>
        <Ionicons name="rocket-outline" size={18} color={colors.textMuted} importantForAccessibility="no" />
        <Text variant="body" weight="600" numberOfLines={1} style={styles.flex}>
          {title}
        </Text>
        <DeploymentStatusBadge status={deployment.status} />
      </View>
      <Text variant="small" tone="muted" numberOfLines={1}>
        {[deployment.environment, when].filter(Boolean).join(' · ')}
      </Text>
      {commit ? (
        <Text variant="mono" tone="muted" numberOfLines={1}>
          {commit}
        </Text>
      ) : null}
    </Pressable>
  );
});

/** Each problem with the timing fact above it, and the correlation note always visible. */
export function ProblemsAfterDeployment({ related }: { related: DeploymentDetail['relatedProblems'] }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const sorted = [...related].sort((a, b) => a.minutesAfterDeployment - b.minutesAfterDeployment);
  return (
    <View style={styles.block}>
      <View style={[styles.note, { backgroundColor: colors.infoBg }]} testID="correlation-note">
        <Ionicons name="information-circle" size={16} color={colors.info} importantForAccessibility="no" />
        <Text variant="small" style={[styles.flex, { color: colors.text }]}>
          {t('deployments.correlationNote')}
        </Text>
      </View>
      {sorted.length === 0 ? (
        <Text tone="muted">{t('deployments.noProblemsAfter')}</Text>
      ) : (
        <Card padded={false}>
          {sorted.map((item, i) => {
            const timing = timingSentence(item.minutesAfterDeployment);
            return (
              <View key={item.problem.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.timing}>
                  <Ionicons name="time-outline" size={14} color={colors.textMuted} importantForAccessibility="no" />
                  <Text variant="small" weight="600" tone="muted" testID={`timing-${item.problem.id}`}>
                    {t(timing.key, timing.params)}
                  </Text>
                </View>
                <ProblemRow problem={item.problem} />
              </View>
            );
          })}
        </Card>
      )}
    </View>
  );
}

export function EvidenceRow({ evidence }: { evidence: RepositoryEvidence }) {
  const openRef = useOpenRef();
  const title = evidence.file ?? evidence.summary ?? evidence.repository;
  return (
    <Row
      testID={`evidence-row-${evidence.id}`}
      title={title}
      subtitle={[evidence.summary && evidence.file ? evidence.summary : null, `${evidence.repository} · ${shortSha(evidence.commit.sha)}`].filter(Boolean).join('\n')}
      icon="code-slash-outline"
      numberOfLines={3}
      onPress={() => openRef({ type: 'evidence', id: evidence.id })}
    />
  );
}

const styles = StyleSheet.create({
  row: { minHeight: TOUCH_TARGET + 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 4 },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  block: { gap: spacing.sm },
  note: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'flex-start' },
  timing: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
});
