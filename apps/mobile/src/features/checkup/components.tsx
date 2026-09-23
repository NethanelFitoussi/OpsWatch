/**
 * The Checkup screen: what is wrong with how this environment is set up.
 *
 * Coverage is rendered **first and always**, above the findings. That ordering is the point of the screen: a list of
 * three findings from a catalogue where two checks were refused is not the same statement as three findings out of
 * twelve that all ran, and showing the list without the denominator invites the reader to believe the wrong one.
 */
import { StyleSheet, View } from 'react-native';
import type { CheckFinding, Checkup, CheckNotRun } from '@/api/contract';
import { useI18n } from '@/i18n';
import { Badge } from '@/ui/badges';
import { Card, Section } from '@/ui/layout';
import { EmptyState } from '@/ui/states';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { checkNameKey, checkValues, isCompleteRun, isKnownCheck, notRunReasonKey, renderCheck, severityMeta, sortFindings } from './helpers';

/** How much of the catalogue answered. Never hidden, never abbreviated away. */
export function Coverage({ coverage }: { coverage: Checkup['coverage'] }) {
  const { t } = useI18n();
  const complete = isCompleteRun(coverage);
  return (
    <Card testID="checkup-coverage">
      <Text variant="body" weight="600">
        {complete
          ? t('checkup.coverage.all', { total: String(coverage.total) })
          : t('checkup.coverage', { ran: String(coverage.ran), total: String(coverage.total) })}
      </Text>
      {complete ? null : (
        <Text variant="small" tone="warning" testID="checkup-coverage-gap">
          {t('checkup.coverage.notRun', { notRun: String(coverage.notRun) })}
        </Text>
      )}
      <Text variant="small" tone="muted" style={styles.note}>
        {t('checkup.difference')}
      </Text>
    </Card>
  );
}

export function Finding({ finding }: { finding: CheckFinding }) {
  const { t } = useI18n();
  const meta = severityMeta(finding.severity);
  return (
    <View style={styles.item} testID={`checkup-finding-${finding.id}`}>
      <Badge tone={meta.tone} icon={meta.icon} label={t(meta.label)} />
      <Text variant="body" style={styles.text}>
        {renderCheck(finding.id, finding.values, t)}
      </Text>
      {isKnownCheck(finding.id) ? null : (
        // A check from a newer server. Naming it keeps the count on screen equal to the count the server sent.
        <Text variant="caption" tone="faint" testID={`checkup-unknown-${finding.id}`}>
          {finding.id}
        </Text>
      )}
    </View>
  );
}

export function NotRun({ check }: { check: CheckNotRun }) {
  const { t } = useI18n();
  return (
    <View style={styles.item} testID={`checkup-notrun-${check.id}`}>
      <Text variant="body" weight="600">
        {t(checkNameKey(check.id), checkValues(check.values, check.id))}
      </Text>
      <Text variant="small" tone="muted">
        {t(notRunReasonKey(check.reason))}
      </Text>
    </View>
  );
}

export function CheckupBody({ checkup }: { checkup: Checkup }) {
  const { t } = useI18n();
  const findings = sortFindings(checkup.findings);
  const complete = isCompleteRun(checkup.coverage);

  return (
    <>
      <Coverage coverage={checkup.coverage} />

      {findings.length === 0 ? (
        <EmptyState
          icon="checkmark-circle-outline"
          title={t('checkup.empty.title')}
          // The wording changes with coverage: "nothing wrong" is only sayable when everything ran.
          body={complete ? t('checkup.empty.body') : t('checkup.empty.partial')}
        />
      ) : (
        <Section title={t('checkup.findings')}>
          <Card testID="checkup-findings">
            {findings.map((finding) => (
              <Finding key={`${finding.id}:${finding.subject ?? ''}`} finding={finding} />
            ))}
          </Card>
        </Section>
      )}

      {checkup.notRun.length === 0 ? null : (
        <Section title={t('checkup.notRun')}>
          <Card testID="checkup-notrun">
            {checkup.notRun.map((check) => (
              <NotRun key={check.id} check={check} />
            ))}
          </Card>
        </Section>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  item: { paddingVertical: spacing.sm, gap: 4 },
  text: { flexShrink: 1 },
  note: { marginTop: spacing.sm },
});
