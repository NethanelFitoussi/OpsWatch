import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useRepositoryEvidence } from '@/api/queries';
import { CommitCard } from '@/features/investigations/components';
import { visibleHighlights } from '@/features/investigations/helpers';
import { AskAiButton } from '@/features/shared/components';
import { useI18n } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';
import { CodeBlock, DiffView } from '@/ui/code';
import { Card, Section } from '@/ui/layout';
import { QueryScreen } from '@/ui/screen';
import { EmptyState, FeatureGate } from '@/ui/states';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';

export default function EvidenceScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!isSafeId(id)) return <EmptyState title={t('error.not_found')} icon="help-circle-outline" />;
  return (
    <FeatureGate feature="repository" label={t('nav.evidence')}>
      <EvidenceDetail id={id} />
    </FeatureGate>
  );
}

function EvidenceDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const query = useRepositoryEvidence(id);
  return (
    <QueryScreen query={query} testID="evidence-screen">
      {(evidence) => (
        <>
          <Text variant="title" accessibilityRole="header" testID="evidence-file">
            {evidence.file ?? evidence.repository}
          </Text>
          {evidence.summary ? (
            <Section title={t('evidence.summary')}>
              <Card>
                <Text>{evidence.summary}</Text>
              </Card>
            </Section>
          ) : null}
          <CommitCard evidence={evidence} />
          {evidence.snippet ? (
            <Section title={t('evidence.code')}>
              <CodeBlock
                lines={evidence.snippet.code}
                startLine={evidence.snippet.startLine}
                highlight={visibleHighlights(evidence.snippet)}
                title={evidence.file}
                testID="evidence-code"
              />
            </Section>
          ) : null}
          {evidence.diff ? (
            <Section title={t('evidence.diff')}>
              <View testID="evidence-diff">
                <DiffView diff={evidence.diff} title={evidence.file} />
              </View>
            </Section>
          ) : null}
          <AskAiButton context={{ type: 'evidence', id: evidence.id }} label={t('evidence.explain')} question={t('evidence.explain')} />
          <View style={styles.note} testID="evidence-server-side">
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.textMuted} importantForAccessibility="no" />
            <Text variant="small" tone="muted" style={styles.noteText}>
              {t('evidence.serverSide')}
            </Text>
          </View>
        </>
      )}
    </QueryScreen>
  );
}

const styles = StyleSheet.create({
  note: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  noteText: { flex: 1 },
});
