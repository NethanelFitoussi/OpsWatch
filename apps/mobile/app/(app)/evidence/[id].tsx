import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useRepositoryEvidence } from '@/api/queries';
import { CommitCard } from '@/features/investigations/components';
import { splitPath, visibleHighlights } from '@/features/investigations/helpers';
import { AskAiButton } from '@/features/shared/components';
import { useI18n } from '@/i18n';
import { isSafeId } from '@/lib/deep-links';
import { NotFoundState } from '@/ui/rows';
import { CodeBlock, DiffView } from '@/ui/code';
import { Card, Section } from '@/ui/layout';
import { QueryScreen } from '@/ui/screen';
import { FeatureGate } from '@/ui/states';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';

export default function EvidenceScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!isSafeId(id)) return <NotFoundState />;
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
      {(evidence) => {
        // A deep path is kept whole but the file name leads it, so the title is readable on a phone.
        const { directory, name } = splitPath(evidence.file ?? evidence.repository);
        return (
          <>
            <Text variant="title" accessibilityRole="header" testID="evidence-file">
              {directory ? (
                <Text variant="title" tone="muted">
                  {directory}
                </Text>
              ) : null}
              {name}
            </Text>
            {evidence.summary ? (
              <Section title={t('evidence.summary')}>
                <Card>
                  <Text>{evidence.summary}</Text>
                </Card>
              </Section>
            ) : null}
            <CommitCard evidence={evidence} />
            {/* Said next to the commit it describes, before the code, not as a footnote under it. */}
            <View style={styles.note} testID="evidence-server-side">
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.textMuted} importantForAccessibility="no" />
              <Text variant="small" tone="muted" style={styles.noteText}>
                {t('evidence.serverSide')}
              </Text>
            </View>
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
          </>
        );
      }}
    </QueryScreen>
  );
}

const styles = StyleSheet.create({
  note: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  noteText: { flex: 1 },
});
